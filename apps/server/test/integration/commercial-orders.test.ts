import { randomUUID } from 'node:crypto';
import { OrderDetailSchema, OrdersResponseSchema } from '@salesforce/contracts';
import { auditLog, integrationOutbox, salesOrder } from '@salesforce/db';
import { computeDiscountedLineTotal, computeLineTotal, decimalEquals, sumTotals, type InstallationConfiguration } from '@salesforce/domain';
import { DEMO_ACCOUNT_EMAILS, DEMO_CONFIGURATION, getDemoDataset } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { OrdersRepository } from '../../src/orders/orders.repository.js';
import { restrictedKeys, startCommercialApp, type CommercialApp, type Json, type Who } from '../helpers/commercial-app.js';
import { TEST_ORIGIN, TEST_PASSWORD, createTestAccount } from '../helpers/auth.js';
import { loginCookie, startAuthApp } from '../helpers/auth-app.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

const dataset = getDemoDataset();
const SELLER_1 = 103;
const SELLER_2 = 107;

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let ctx: CommercialApp;

// Fixtures chosen from the API itself (so they are visible and orderable by construction).
let customer1: number; // seller 103, active, unblocked, with its own price table
let customer2: number; // seller 107
let priced: Json[]; // sellable products with a price for customer1
let unpriced: Json; // sellable product with no price for customer1
let notSellable: Json;

beforeAll(async () => {
  postgres = await startPostgres();
  ctx = await startCommercialApp(postgres, opened);
  const own = (seller: number) => dataset.customers.find((c) => c.sellerCode === seller && c.active && !c.blocked && c.priceTableCode === 21);
  const c1 = own(SELLER_1);
  const c2 = own(SELLER_2);
  if (c1 === undefined || c2 === undefined) throw new Error('fixture lacks orderable customers');
  customer1 = c1.code;
  customer2 = c2.code;
  const list = async (query: string): Promise<Json[]> => (await ctx.call('manager', 'GET', `/products?customerCode=${customer1}&pageSize=100&${query}`)).body.items;
  priced = (await list('sellable=true&priceState=priced')).slice(0, 4);
  unpriced = (await list('sellable=true&priceState=none'))[0];
  notSellable = (await list('sellable=false'))[0];
  if (priced.length < 3 || unpriced === undefined || notSellable === undefined) throw new Error('fixture lacks products');
});

afterAll(async () => {
  for (const close of opened.reverse()) await close();
  await postgres.stop();
});

const draftBody = (overrides: Record<string, unknown> = {}, customerCode = customer1) => ({
  clientRequestId: randomUUID(),
  customerCode,
  negotiationTypeCode: 2,
  notes: 'pedido de teste',
  items: [
    { productCode: priced[0]?.code, quantity: '2' },
    { productCode: priced[1]?.code, quantity: '3.5' },
  ],
  ...overrides,
});

const expectedTotal = (lines: readonly { price: string; quantity: string }[]) =>
  sumTotals(lines.map((line) => computeLineTotal(line.quantity, line.price)));

const create = (who: Who, body: unknown) => ctx.call(who, 'POST', '/orders', body);

describe('create draft', () => {
  it('201: prices and totals come from the server (domain rules), contract-valid', async () => {
    const { status, body } = await create('seller1', draftBody());
    expect(status).toBe(201);
    expect(OrderDetailSchema.safeParse(body).success).toBe(true);
    expect(body.status).toBe('draft');
    expect(body.version).toBe(1);
    expect(body.erpNumber).toBeNull();
    expect(body.sellerCode).toBe(SELLER_1);
    expect(body.items).toHaveLength(2);
    for (const item of body.items) expect(item.priceState).toBe('priced');
    const total = expectedTotal([
      { price: priced[0]?.listPrice.unitPrice, quantity: '2' },
      { price: priced[1]?.listPrice.unitPrice, quantity: '3.5' },
    ]);
    expect(decimalEquals(body.totals.estimatedTotal, total)).toBe(true);
    expect(decimalEquals(body.estimatedTotal, total)).toBe(true);
    expect(body.isPartial).toBe(false);
    expect(restrictedKeys(body)).toEqual([]);
  });

  it('rejects a client-sent price or extra field (never silently ignored)', async () => {
    const withPrice = draftBody({ items: [{ productCode: priced[0]?.code, quantity: '1', unitPrice: '0.01' }] });
    const response = await create('seller1', withPrice);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('validation_failed');
    expect((await create('seller1', { ...draftBody(), discountPercent: '10' })).status).toBe(400);
  });

  it('domain issues become validation_failed with stable issue codes', async () => {
    const unknown = await create('seller1', draftBody({ items: [{ productCode: 1, quantity: '1' }] }));
    expect(unknown.status).toBe(400);
    expect(unknown.body.details.issues.map((issue: Json) => issue.code)).toContain('product_unknown');

    const zero = await create('seller1', draftBody({ items: [{ productCode: priced[0]?.code, quantity: '0' }] }));
    expect(zero.status).toBe(400);
    expect(zero.body.details.issues.map((issue: Json) => issue.code)).toContain('invalid_quantity');

    const nonSellable = await create('seller1', draftBody({ items: [{ productCode: notSellable.code, quantity: '1' }] }));
    expect(nonSellable.status).toBe(400);
    expect(nonSellable.body.details.issues.map((issue: Json) => issue.code)).toContain('product_not_sellable');
  });

  it('a product without a price is never priced at 0: the configuration says it is not orderable', async () => {
    const response = await create('seller1', draftBody({ items: [{ productCode: unpriced.code, quantity: '1' }] }));
    expect(response.status).toBe(400);
    expect(response.body.details.issues.map((issue: Json) => issue.code)).toContain('line_not_orderable');
  });

  it('a product without a price can be drafted when the installation allows it, and stays "Sem preço" (null, never 0)', async () => {
    const permissive: InstallationConfiguration = {
      ...DEMO_CONFIGURATION,
      sales: { ...DEMO_CONFIGURATION.sales, orderBehavior: { allowDraftWithoutPrice: true } },
      products: { ...DEMO_CONFIGURATION.products, productWithoutPrice: { visible: true, orderable: true } },
    };
    const other = await startCommercialApp(postgres, opened, { configuration: permissive });
    const target = (await other.call('manager', 'GET', `/products?customerCode=${customer1}&sellable=true&priceState=none&pageSize=1`)).body.items[0];
    const response = await other.call('seller1', 'POST', '/orders', {
      ...draftBody({
        items: [
          { productCode: priced[0]?.code, quantity: '1' },
          { productCode: target.code, quantity: '5' },
        ],
      }),
    });
    expect(response.status).toBe(201);
    const line = response.body.items.find((item: Json) => item.productCode === target.code);
    expect(line.priceState).toBe('none');
    expect(line.unitListPrice).toBeNull();
    expect(line.estimatedLineTotal).toBeNull();
    expect(response.body.isPartial).toBe(true);
    expect(response.body.totals.unpricedLineCount).toBe(1);
    // The estimate covers only the priced line: the missing price adds nothing and is not shown as 0.
    expect(decimalEquals(response.body.totals.estimatedTotal, computeLineTotal('1', priced[0]?.listPrice.unitPrice))).toBe(true);
    const listed = await other.call('seller1', 'GET', '/orders');
    expect(listed.body.items[0].isPartial).toBe(true);
  });

  it('a seller cannot draft for a customer outside their portfolio (404, like an unknown customer)', async () => {
    const foreign = await create('seller1', draftBody({}, customer2));
    const unknown = await create('seller1', draftBody({}, 2_000_000_000));
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(foreign.body.code).toBe(unknown.body.code);
    expect(await ctx.database.handle.db.select().from(salesOrder).where(eq(salesOrder.customerCode, customer2))).toHaveLength(0);
  });

  it('a manager can draft for any customer; the order carries the customer seller', async () => {
    const { status, body } = await create('manager', draftBody({}, customer2));
    expect(status).toBe(201);
    expect(body.sellerCode).toBe(SELLER_2);
  });

  it('an empty item list is a valid draft', async () => {
    const { status, body } = await create('seller1', draftBody({ items: [] }));
    expect(status).toBe(201);
    expect(body.items).toEqual([]);
    expect(body.totals.estimatedTotal).toMatch(/^0(\.0+)?$/);
  });
});

describe('idempotency (clientRequestId)', () => {
  it('same id and same payload: 200 with the original order, one row', async () => {
    const payload = draftBody();
    const first = await create('seller1', payload);
    const again = await create('seller1', payload);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    const rows = await ctx.database.handle.db.select().from(salesOrder).where(eq(salesOrder.clientRequestId, payload.clientRequestId));
    expect(rows).toHaveLength(1);
  });

  it('a line order that does not change the meaning still counts as a different payload only when content differs', async () => {
    const payload = draftBody();
    await create('seller1', payload);
    const changedQuantity = { ...payload, items: [{ productCode: priced[0]?.code, quantity: '9' }, payload.items[1]] };
    const conflict = await create('seller1', changedQuantity);
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('idempotency_conflict');
    const changedNotes = await create('seller1', { ...payload, notes: 'outro texto' });
    expect(changedNotes.status).toBe(409);
    expect(changedNotes.body.code).toBe('idempotency_conflict');
    // Equivalent decimal spelling is the same payload.
    const sameQuantity = await create('seller1', { ...payload, items: [{ productCode: priced[0]?.code, quantity: '2.0000' }, payload.items[1]] });
    expect(sameQuantity.status).toBe(200);
  });

  it('another account reusing the id gets idempotency_conflict and learns nothing about the order', async () => {
    const payload = draftBody({}, customer1);
    const original = await create('seller1', payload);
    const stolen = await create('seller2', payload);
    expect(stolen.status).toBe(409);
    expect(stolen.body.code).toBe('idempotency_conflict');
    expect(JSON.stringify(stolen.body)).not.toContain(original.body.id);
    // Even a manager (who could see the customer) cannot adopt someone else's request id.
    const adopted = await create('manager', payload);
    expect(adopted.status).toBe(409);
  });

  it('concurrent creates with one id produce exactly one order', async () => {
    const payload = draftBody();
    const results = await Promise.all(Array.from({ length: 6 }, () => create('seller1', payload)));
    const statuses = results.map((result) => result.status).sort();
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 200)).toHaveLength(5);
    expect(new Set(results.map((result) => result.body.id)).size).toBe(1);
    const rows = await ctx.database.handle.db.select().from(salesOrder).where(eq(salesOrder.clientRequestId, payload.clientRequestId));
    expect(rows).toHaveLength(1);
  });
});

describe('replace, discard, submit', () => {
  it('replace with the current version recomputes items and bumps the version; a stale version is version_conflict', async () => {
    const created = await create('seller1', draftBody());
    const id = created.body.id;
    const replaced = await ctx.call('seller1', 'PUT', `/orders/${id}`, {
      expectedVersion: 1,
      customerCode: customer1,
      negotiationTypeCode: 3,
      notes: null,
      items: [{ productCode: priced[2]?.code, quantity: '10' }],
    });
    expect(replaced.status).toBe(200);
    expect(replaced.body.version).toBe(2);
    expect(replaced.body.items).toHaveLength(1);
    expect(replaced.body.negotiationTypeCode).toBe(3);
    expect(replaced.body.notes).toBeNull();
    expect(decimalEquals(replaced.body.totals.estimatedTotal, computeLineTotal('10', priced[2]?.listPrice.unitPrice))).toBe(true);

    const stale = await ctx.call('seller1', 'PUT', `/orders/${id}`, {
      expectedVersion: 1,
      customerCode: customer1,
      negotiationTypeCode: 2,
      notes: null,
      items: [],
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('version_conflict');
    expect(stale.body.details.currentVersion).toBe(2);
    const after = await ctx.call('seller1', 'GET', `/orders/${id}`);
    expect(after.body.version).toBe(2);
    expect(after.body.items).toHaveLength(1);
  });

  it('two concurrent replaces with the same expectedVersion: exactly one wins', async () => {
    const created = await create('seller1', draftBody());
    const replace = (quantity: string) =>
      ctx.call('seller1', 'PUT', `/orders/${created.body.id}`, {
        expectedVersion: 1,
        customerCode: customer1,
        negotiationTypeCode: 2,
        notes: null,
        items: [{ productCode: priced[0]?.code, quantity }],
      });
    const results = await Promise.all([replace('1'), replace('2'), replace('3')]);
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(results.filter((result) => result.status === 409 && result.body.code === 'version_conflict')).toHaveLength(2);
    expect((await ctx.call('seller1', 'GET', `/orders/${created.body.id}`)).body.version).toBe(2);
  });

  it('replace validates the new draft like create (invalid lines change nothing)', async () => {
    const created = await create('seller1', draftBody());
    const invalid = await ctx.call('seller1', 'PUT', `/orders/${created.body.id}`, {
      expectedVersion: 1,
      customerCode: customer1,
      negotiationTypeCode: 2,
      notes: null,
      items: [{ productCode: 1, quantity: '1' }],
    });
    expect(invalid.status).toBe(400);
    const after = await ctx.call('seller1', 'GET', `/orders/${created.body.id}`);
    expect(after.body.version).toBe(1);
    expect(after.body.items).toHaveLength(2);
  });

  it('discard makes the draft cancelled; then replace, discard and any edit are order_not_editable', async () => {
    const created = await create('seller1', draftBody());
    const id = created.body.id;
    const discarded = await ctx.call('seller1', 'DELETE', `/orders/${id}`);
    expect(discarded.status).toBe(200);
    expect(discarded.body.status).toBe('cancelled');
    expect(discarded.body.version).toBe(2);

    const replaceAfter = await ctx.call('seller1', 'PUT', `/orders/${id}`, {
      expectedVersion: 2,
      customerCode: customer1,
      negotiationTypeCode: 2,
      notes: null,
      items: [],
    });
    expect(replaceAfter.status).toBe(409);
    expect(replaceAfter.body.code).toBe('order_not_editable');
    const discardAgain = await ctx.call('seller1', 'DELETE', `/orders/${id}`);
    expect(discardAgain.status).toBe(409);
    expect(discardAgain.body.code).toBe('order_not_editable');
    // The draft number and history stay readable.
    expect((await ctx.call('seller1', 'GET', `/orders/${id}`)).body.status).toBe('cancelled');
  });

  it('a non-editable status is reported before a version mismatch', async () => {
    const created = await create('seller1', draftBody());
    await ctx.call('seller1', 'DELETE', `/orders/${created.body.id}`);
    const response = await ctx.call('seller1', 'PUT', `/orders/${created.body.id}`, {
      expectedVersion: 1,
      customerCode: customer1,
      negotiationTypeCode: 2,
      notes: null,
      items: [],
    });
    expect(response.body.code).toBe('order_not_editable');
  });

  it('submit is ALWAYS 409 erp_submission_disabled: no outbox row, no status change, attempt audited', async () => {
    const created = await create('seller1', draftBody());
    const id = created.body.id;
    const before = await ctx.database.handle.db.select().from(integrationOutbox);
    const response = await ctx.call('seller1', 'POST', `/orders/${id}/submit`);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('erp_submission_disabled');
    const outboxAfter = await ctx.database.handle.db.select().from(integrationOutbox);
    expect(outboxAfter).toHaveLength(before.length);
    expect(outboxAfter).toHaveLength(0);

    const order = await ctx.call('seller1', 'GET', `/orders/${id}`);
    expect(order.body.status).toBe('draft');
    expect(order.body.erpNumber).toBeNull();
    expect(order.body.version).toBe(1);

    const audits = (await ctx.database.handle.db.select().from(auditLog)).filter((row) => row.action === 'order.submit_attempted');
    expect(audits.some((row) => (row.detail as Json).orderId === id && (row.detail as Json).outcome === 'erp_submission_disabled')).toBe(true);
    // Still refused for a cancelled order and for a manager: it is not a permission question.
    await ctx.call('seller1', 'DELETE', `/orders/${id}`);
    expect((await ctx.call('seller1', 'POST', `/orders/${id}/submit`)).body.code).toBe('erp_submission_disabled');
    expect((await ctx.call('manager', 'POST', `/orders/${id}/submit`)).body.code).toBe('erp_submission_disabled');
    expect((await ctx.call('admin', 'POST', `/orders/${id}/submit`)).body.code).toBe('erp_submission_disabled');
  });

  it('audits create, replace and discard with identifiers only (no notes, no payload)', async () => {
    const notes = 'texto-livre-que-nao-deve-ir-para-a-auditoria';
    const created = await create('seller1', draftBody({ notes }));
    const id = created.body.id;
    await ctx.call('seller1', 'PUT', `/orders/${id}`, { expectedVersion: 1, customerCode: customer1, negotiationTypeCode: 2, notes, items: [] });
    await ctx.call('seller1', 'DELETE', `/orders/${id}`);
    const rows = (await ctx.database.handle.db.select().from(auditLog)).filter((row) => (row.detail as Json | null)?.orderId === id);
    expect(rows.map((row) => row.action).sort()).toEqual(['order.created', 'order.discarded', 'order.replaced']);
    expect(JSON.stringify(rows)).not.toContain(notes);
    expect(rows.every((row) => row.actorAccountId === ctx.accounts.ids[DEMO_ACCOUNT_EMAILS.seller1])).toBe(true);
  });

  it('a malformed order id is 400; an unknown id is 404', async () => {
    expect((await ctx.call('seller1', 'GET', '/orders/not-a-uuid')).status).toBe(400);
    expect((await ctx.call('seller1', 'GET', `/orders/${randomUUID()}`)).status).toBe(404);
    expect((await ctx.call('seller1', 'POST', `/orders/${randomUUID()}/submit`)).status).toBe(404);
  });
});

describe('list orders', () => {
  it('filters, sorts and paginates inside the scope', async () => {
    const first = await create('seller1', draftBody());
    const second = await create('seller1', draftBody({ notes: 'lista' }));
    await ctx.call('seller1', 'DELETE', `/orders/${second.body.id}`);

    const drafts = await ctx.call('seller1', 'GET', '/orders?status=draft&pageSize=100');
    expect(OrdersResponseSchema.safeParse(drafts.body).success).toBe(true);
    expect(drafts.body.items.every((order: Json) => order.status === 'draft')).toBe(true);
    expect(drafts.body.items.map((order: Json) => order.id)).toContain(first.body.id);
    expect(drafts.body.items.map((order: Json) => order.id)).not.toContain(second.body.id);

    const cancelled = await ctx.call('seller1', 'GET', '/orders?status=cancelled&pageSize=100');
    expect(cancelled.body.items.map((order: Json) => order.id)).toContain(second.body.id);

    const byNumber = await ctx.call('seller1', 'GET', '/orders?sort=draftNumber&pageSize=100');
    const numbers = byNumber.body.items.map((order: Json) => order.draftNumber);
    expect(numbers).toEqual([...numbers].sort((a: number, b: number) => a - b));

    const page = await ctx.call('seller1', 'GET', '/orders?pageSize=2&page=1');
    expect(page.body.items).toHaveLength(2);
    expect(page.body.total).toBeGreaterThan(2);
    expect(page.body.items[0].itemCount).toBeGreaterThanOrEqual(0);

    const byCustomer = await ctx.call('manager', 'GET', `/orders?customerCode=${customer2}&pageSize=100`);
    expect(byCustomer.body.items.every((order: Json) => order.customerCode === customer2)).toBe(true);
    const bySearch = await ctx.call('seller1', 'GET', `/orders?search=${encodeURIComponent(first.body.customerName.slice(0, 6))}&pageSize=100`);
    expect(bySearch.body.items.map((order: Json) => order.id)).toContain(first.body.id);
  });
});

describe('list orders: commercial filters (period, products, combinations)', () => {
  const at = (iso: string) => new Date(iso);
  let A: string; // products 0+1, created 10/03/2026, edited 02/05/2026
  let B: string; // products 1+2, created 31/03/2026 23:30 in Brasilia (already 01/04 in UTC)
  let C: string; // products 0+1+2, created now
  let foreign: string; // seller 2, product 2 only
  let mine: Set<string>;
  const code = (index: number) => Number(priced[index]?.code);
  const ids = async (who: Who, query: string): Promise<string[]> => {
    const { status, body } = await ctx.call(who, 'GET', `/orders?pageSize=100&${query}`);
    expect(status, query).toBe(200);
    expect(OrdersResponseSchema.safeParse(body).success, query).toBe(true);
    return body.items.map((order: Json) => order.id).filter((id: string) => mine.has(id));
  };
  const line = (index: number) => ({ productCode: code(index), quantity: '1' });

  beforeAll(async () => {
    const make = async (who: Who, items: unknown[], customerCode = customer1) =>
      (await create(who, draftBody({ items }, customerCode))).body.id as string;
    A = await make('seller1', [line(0), line(1)]);
    B = await make('seller1', [line(1), line(2)]);
    C = await make('seller1', [line(0), line(1), line(2)]);
    foreign = await make('seller2', [line(2)], customer2);
    mine = new Set([A, B, C, foreign]);
    const { db } = ctx.database.handle;
    await db.update(salesOrder).set({ createdAt: at('2026-03-10T15:00:00Z'), updatedAt: at('2026-05-02T15:00:00Z') }).where(eq(salesOrder.id, A));
    await db.update(salesOrder).set({ createdAt: at('2026-04-01T02:30:00Z'), updatedAt: at('2026-04-01T02:30:00Z') }).where(eq(salesOrder.id, B));
  });

  it('period: inclusive on both ends, read as calendar dates in America/Sao_Paulo', async () => {
    expect(await ids('seller1', 'from=2026-03-10&to=2026-03-10')).toEqual([A]);
    // B was created 23:30 of 31/03 in Brasilia, although it is already 01/04 in UTC.
    expect(await ids('seller1', 'from=2026-03-31&to=2026-03-31')).toEqual([B]);
    expect(await ids('seller1', 'from=2026-04-01&to=2026-04-01')).toEqual([]);
    expect((await ids('seller1', 'from=2026-03-01&to=2026-03-31')).sort()).toEqual([A, B].sort());
    expect((await ids('seller1', 'to=2026-03-31')).sort()).toEqual([A, B].sort());
    expect(await ids('seller1', 'from=2026-04-01')).toEqual([C]);
  });

  it('dateField picks the creation date (default) or the last update', async () => {
    expect(await ids('seller1', 'from=2026-05-01&to=2026-05-31')).toEqual([]);
    expect(await ids('seller1', 'from=2026-05-01&to=2026-05-31&dateField=createdAt')).toEqual([]);
    expect(await ids('seller1', 'from=2026-05-01&to=2026-05-31&dateField=updatedAt')).toEqual([A]);
  });

  it('a malformed or inverted period, or a malformed product list, is a 400 and never reaches the database', async () => {
    for (const query of [
      'from=2026-13-40',
      'from=10/03/2026',
      'to=ontem',
      'from=2026-05-02&to=2026-05-01',
      'dateField=deletedAt',
      'productCodes=abc',
      'productCodes=1,,2',
      'productCodes=-1',
      `productCodes=${Array.from({ length: 21 }, (_, i) => i + 1).join(',')}`,
      'productMatch=some',
    ]) {
      const { status, body } = await ctx.call('seller1', 'GET', `/orders?${query}`);
      expect(status, query).toBe(400);
      expect(body.code, query).toBe('validation_failed');
    }
  });

  it('one product: every order with a line for it', async () => {
    expect((await ids('seller1', `productCodes=${code(0)}`)).sort()).toEqual([A, C].sort());
    expect((await ids('seller1', `productCodes=${code(2)}`)).sort()).toEqual([B, C].sort());
    expect(await ids('seller1', 'productCodes=999999999')).toEqual([]);
    expect(await ids('seller1', 'productCodes=99999999999999')).toEqual([]);
  });

  it('several products: "any" (default) is the union, "all" is the intersection', async () => {
    const both = `productCodes=${code(0)},${code(2)}`;
    expect((await ids('seller1', both)).sort()).toEqual([A, B, C].sort());
    expect((await ids('seller1', `${both}&productMatch=any`)).sort()).toEqual([A, B, C].sort());
    expect(await ids('seller1', `${both}&productMatch=all`)).toEqual([C]);
    expect((await ids('seller1', `productCodes=${code(0)},${code(1)}&productMatch=all`)).sort()).toEqual([A, C].sort());
  });

  it('"all" with an unknown product finds nothing, "any" ignores it; a repeated code counts once', async () => {
    expect(await ids('seller1', `productCodes=${code(0)},999999999&productMatch=all`)).toEqual([]);
    expect((await ids('seller1', `productCodes=${code(0)},999999999&productMatch=any`)).sort()).toEqual([A, C].sort());
    expect(await ids('seller1', `productCodes=${code(0)},${code(0)},${code(2)}&productMatch=all`)).toEqual([C]);
    expect(await ids('seller1', `productCodes=${code(0)},99999999999999&productMatch=all`)).toEqual([]);
  });

  it('productSearch: orders with a line whose description contains the text (any case) or whose code is typed', async () => {
    const description = String(priced[0]?.description);
    const fragment = description.slice(0, Math.min(6, description.length));
    const byText = await ids('seller1', `productSearch=${encodeURIComponent(fragment.toLowerCase())}`);
    expect(byText).toEqual(expect.arrayContaining([A, C]));
    expect((await ids('seller1', `productSearch=${code(0)}`)).sort()).toEqual(expect.arrayContaining([A, C]));
    expect(await ids('seller1', 'productSearch=zzzz-sem-produto')).toEqual([]);
    // Combines with the product list and a wildcard typed by the user is literal.
    expect(await ids('seller1', `productSearch=${encodeURIComponent(description)}&productCodes=${code(2)}&productMatch=all`)).toEqual([C]);
    expect(await ids('seller1', 'productSearch=%25')).toEqual([]);
  });

  it('all filters work together (customer + period + products + status)', async () => {
    const both = `customerCode=${customer1}&status=draft&productCodes=${code(1)},${code(2)}&productMatch=all`;
    expect((await ids('seller1', both)).sort()).toEqual([B, C].sort());
    expect(await ids('seller1', `${both}&from=2026-03-01&to=2026-03-31`)).toEqual([B]);
    expect(await ids('seller1', `${both}&from=2026-03-01&to=2026-03-31&dateField=updatedAt`)).toEqual([B]);
    expect(await ids('seller1', `${both}&from=2026-03-01&to=2026-03-09`)).toEqual([]);
    expect(await ids('seller1', `customerCode=${customer1}&productCodes=${code(1)}&status=cancelled`)).toEqual([]);
    expect(await ids('manager', `customerCode=${customer2}&productCodes=${code(2)}`)).toEqual([foreign]);
  });

  it('the total and the pages follow the filter', async () => {
    const query = `productCodes=${code(0)},${code(1)}&productMatch=all&sort=draftNumber`;
    const full = await ctx.call('seller1', 'GET', `/orders?${query}&pageSize=100`);
    const total = full.body.total as number;
    expect(total).toBeGreaterThanOrEqual(2);
    const firstPage = await ctx.call('seller1', 'GET', `/orders?${query}&pageSize=1&page=1`);
    const lastPage = await ctx.call('seller1', 'GET', `/orders?${query}&pageSize=1&page=${total}`);
    expect(firstPage.body.total).toBe(total);
    expect(firstPage.body.items).toHaveLength(1);
    expect(firstPage.body.items[0].id).toBe(full.body.items[0].id);
    expect(lastPage.body.items[0].id).toBe(full.body.items[total - 1].id);
  });

  it('the list preview shows up to 3 line descriptions, the filtered products first', async () => {
    const lastIndex = priced[3] ? 3 : 2;
    const wide = await create('seller1', draftBody({ items: Array.from({ length: lastIndex + 1 }, (_, index) => line(index)) }));
    mine.add(wide.body.id);
    const plain = await ctx.call('seller1', 'GET', '/orders?pageSize=100');
    const plainItem = plain.body.items.find((order: Json) => order.id === wide.body.id);
    expect(plainItem.itemCount).toBe(lastIndex + 1);
    expect(plainItem.itemPreview).toEqual(priced.slice(0, 3).map((product) => product.description));

    const filtered = await ctx.call('seller1', 'GET', `/orders?pageSize=100&productCodes=${code(lastIndex)}`);
    const filteredItem = filtered.body.items.find((order: Json) => order.id === wide.body.id);
    expect(filteredItem.itemPreview).toHaveLength(3);
    expect(filteredItem.itemPreview[0]).toBe(priced[lastIndex]?.description);
  });

  it('scope: a seller never finds another seller order through the product or period filters', async () => {
    expect(await ids('seller1', `productCodes=${code(2)}`)).not.toContain(foreign);
    expect(await ids('seller1', `productCodes=${code(2)}&customerCode=${customer2}`)).toEqual([]);
    expect(await ids('seller1', `from=${new Date().toISOString().slice(0, 10)}&productCodes=${code(2)}`)).not.toContain(foreign);
    expect(await ids('seller2', `productCodes=${code(2)}`)).toEqual([foreign]);
    expect(await ids('manager', `productCodes=${code(2)}`)).toContain(foreign);
  });
});

describe('IDOR: a seller never reaches another seller data', () => {
  let foreignId: string;
  let foreignCustomer: number;
  beforeAll(async () => {
    const other = await create('seller2', draftBody({}, customer2));
    expect(other.status).toBe(201);
    foreignId = other.body.id;
    foreignCustomer = customer2;
  });

  const editBody = () => ({ expectedVersion: 1, customerCode: foreignCustomer, negotiationTypeCode: 2, notes: null, items: [] });

  it('detail, replace, discard and submit of another seller order are 404, identical to a missing order', async () => {
    const missingId = randomUUID();
    const pairs: [string, () => Promise<{ status: number; body: Json }>, () => Promise<{ status: number; body: Json }>][] = [
      ['get', () => ctx.call('seller1', 'GET', `/orders/${foreignId}`), () => ctx.call('seller1', 'GET', `/orders/${missingId}`)],
      ['replace', () => ctx.call('seller1', 'PUT', `/orders/${foreignId}`, editBody()), () => ctx.call('seller1', 'PUT', `/orders/${missingId}`, editBody())],
      ['discard', () => ctx.call('seller1', 'DELETE', `/orders/${foreignId}`), () => ctx.call('seller1', 'DELETE', `/orders/${missingId}`)],
      ['submit', () => ctx.call('seller1', 'POST', `/orders/${foreignId}/submit`), () => ctx.call('seller1', 'POST', `/orders/${missingId}/submit`)],
    ];
    for (const [name, foreign, missing] of pairs) {
      const [f, m] = [await foreign(), await missing()];
      expect(f.status, name).toBe(404);
      expect(m.status, name).toBe(404);
      expect({ ...f.body, details: undefined }, name).toEqual({ ...m.body, details: undefined });
    }
    // Nothing changed: still a version-1 draft, and no submit attempt was audited for it.
    const untouched = await ctx.call('manager', 'GET', `/orders/${foreignId}`);
    expect(untouched.body.status).toBe('draft');
    expect(untouched.body.version).toBe(1);
    const attempts = (await ctx.database.handle.db.select().from(auditLog)).filter(
      (row) => row.action === 'order.submit_attempted' && (row.detail as Json).orderId === foreignId,
    );
    expect(attempts).toHaveLength(0);
  });

  it('the list never contains another seller order, whatever filter is used', async () => {
    for (const query of ['', `?customerCode=${foreignCustomer}`, '?status=draft', `?search=${encodeURIComponent(foreignId)}`]) {
      const { body } = await ctx.call('seller1', 'GET', `/orders${query}${query === '' ? '?' : '&'}pageSize=100`);
      expect(body.items.map((order: Json) => order.id), query).not.toContain(foreignId);
      expect(body.items.every((order: Json) => order.sellerCode === SELLER_1), query).toBe(true);
    }
  });

  it('a seller cannot move their own draft onto another seller customer', async () => {
    const own = await create('seller1', draftBody());
    const moved = await ctx.call('seller1', 'PUT', `/orders/${own.body.id}`, { ...editBody(), expectedVersion: 1 });
    expect(moved.status).toBe(404);
    expect((await ctx.call('seller1', 'GET', `/orders/${own.body.id}`)).body.customerCode).toBe(customer1);
  });

  it('managers and admins see every order', async () => {
    expect((await ctx.call('manager', 'GET', `/orders/${foreignId}`)).status).toBe(200);
    expect((await ctx.call('admin', 'GET', `/orders/${foreignId}`)).status).toBe(200);
  });

  it('order bodies never carry cost or margin', async () => {
    const list = await ctx.call('manager', 'GET', '/orders?pageSize=100');
    expect(restrictedKeys(list.body)).toEqual([]);
    expect(restrictedKeys((await ctx.call('manager', 'GET', `/orders/${foreignId}`)).body)).toEqual([]);
  });
});

describe('IDOR race: the order leaves the caller scope between the unlocked read and the row lock (L3.1)', () => {
  /**
   * After the caller's first (unlocked) read of the order, another writer moves it to seller 2 and bumps
   * its version. The locked re-read must decide scope BEFORE version: the caller gets the same 404 as
   * for a missing order, never a version_conflict that shows the order exists and its current version.
   */
  async function moveAfterFirstRead(orderId: string): Promise<() => void> {
    const original = OrdersRepository.prototype.findById;
    let moved = false;
    const spy = vi.spyOn(OrdersRepository.prototype, 'findById').mockImplementation(async function (this: OrdersRepository, ...args) {
      const row = await original.apply(this, args);
      if (!moved && args[0] === orderId && args[2] !== true) {
        moved = true;
        await ctx.database.handle.pool.query('update sales_order set seller_code = $1, version = version + 1 where id = $2', [SELLER_2, orderId]);
      }
      return row;
    });
    return () => spy.mockRestore();
  }

  const body = (version: number) => ({ expectedVersion: version, customerCode: customer1, negotiationTypeCode: 2, notes: null, items: [] });

  it('replace answers 404 (not version_conflict) when the locked row is out of scope', async () => {
    const created = await create('seller1', draftBody());
    const restore = await moveAfterFirstRead(created.body.id);
    try {
      const result = await ctx.call('seller1', 'PUT', `/orders/${created.body.id}`, body(1));
      const missing = await ctx.call('seller1', 'PUT', `/orders/${randomUUID()}`, body(1));
      expect(result.status).toBe(404);
      expect(result.body.code).toBe('not_found');
      expect(result.body.code).toBe(missing.body.code);
      expect(JSON.stringify(result.body)).not.toContain('currentVersion');
    } finally {
      restore();
    }
  });

  it('discard answers 404 when the locked row is out of scope, and does not cancel it', async () => {
    const created = await create('seller1', draftBody());
    const restore = await moveAfterFirstRead(created.body.id);
    try {
      const result = await ctx.call('seller1', 'DELETE', `/orders/${created.body.id}`);
      expect(result.status).toBe(404);
      expect(result.body.code).toBe('not_found');
    } finally {
      restore();
    }
    const [row] = await ctx.database.handle.db.select().from(salesOrder).where(eq(salesOrder.id, created.body.id));
    expect(row?.status).toBe('draft');
  });
});

describe('installation not enabled', () => {
  it('every commercial endpoint answers installation_not_enabled (409) until the installation is enabled', async () => {
    const disabled: InstallationConfiguration = { ...DEMO_CONFIGURATION, general: { ...DEMO_CONFIGURATION.general, enabled: false } };
    const app = await startCommercialApp(postgres, opened, { configuration: disabled });
    const probes: [Parameters<CommercialApp['call']>[1], string, unknown?][] = [
      ['GET', '/customers'],
      ['GET', `/customers/${customer1}`],
      ['GET', '/products'],
      ['GET', '/product-groups'],
      ['GET', '/dashboard'],
      ['GET', '/orders'],
      ['POST', '/orders', draftBody()],
    ];
    for (const [method, url, body] of probes) {
      const response = await app.call('seller1', method, url, body);
      expect(response.status, `${method} ${url}`).toBe(409);
      expect(response.body.code, `${method} ${url}`).toBe('installation_not_enabled');
    }
    expect(await app.database.handle.db.select().from(salesOrder)).toHaveLength(0);
  });

  it('no stored configuration at all is also installation_not_enabled, never a 500', async () => {
    const bare = await startAuthApp(postgres, opened);
    await createTestAccount(bare.database.handle, { email: 'sem-config@example.test', role: 'manager' }, bare.clock.fn);
    const cookie = await loginCookie(bare, 'sem-config@example.test', TEST_PASSWORD);
    const response = await bare.app.inject({ method: 'GET', url: '/api/v1/customers', headers: { cookie, origin: TEST_ORIGIN } });
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).code).toBe('installation_not_enabled');
  });
});

describe('line discounts (drafts only: authority approval is not decided, R35/R36)', () => {
  const discounted = (discountPercent: string) =>
    draftBody({
      items: [
        { productCode: priced[0]?.code, quantity: '2', discountPercent },
        { productCode: priced[1]?.code, quantity: '3.5' },
      ],
    });

  it('the server applies the percentage to that line, rounding once, and the totals follow', async () => {
    const { status, body } = await create('seller1', discounted('12.5'));
    expect(status).toBe(201);
    expect(OrderDetailSchema.safeParse(body).success).toBe(true);
    expect(body.items[0].discountPercent).toBe('12.5');
    expect(body.items[1].discountPercent).toBe('0');
    const first = computeDiscountedLineTotal('2', priced[0]?.listPrice.unitPrice, '12.5');
    expect(decimalEquals(body.items[0].estimatedLineTotal, first)).toBe(true);
    expect(decimalEquals(body.items[1].estimatedLineTotal, computeLineTotal('3.5', priced[1]?.listPrice.unitPrice))).toBe(true);
    const total = sumTotals([first, computeLineTotal('3.5', priced[1]?.listPrice.unitPrice)]);
    expect(decimalEquals(body.totals.estimatedTotal, total)).toBe(true);
    expect(restrictedKeys(body)).toEqual([]);
  });

  it('is stored and read back by GET, and a line with no discount reads "0"', async () => {
    const created = await create('seller1', discounted('7.25'));
    const read = await ctx.call('seller1', 'GET', `/orders/${created.body.id}`);
    expect(read.body.items.map((item: Json) => item.discountPercent)).toEqual(['7.25', '0']);
    expect(read.body.items).toEqual(created.body.items);
  });

  it('replace recomputes with the new percentage (last write wins) and can remove it', async () => {
    const created = await create('seller1', discounted('10'));
    const id = created.body.id;
    const replaced = await ctx.call('seller1', 'PUT', `/orders/${id}`, {
      expectedVersion: 1,
      customerCode: customer1,
      negotiationTypeCode: 2,
      notes: null,
      items: [{ productCode: priced[0]?.code, quantity: '2', discountPercent: '20' }],
    });
    expect(replaced.status).toBe(200);
    expect(replaced.body.items[0].discountPercent).toBe('20');
    expect(decimalEquals(replaced.body.totals.estimatedTotal, computeDiscountedLineTotal('2', priced[0]?.listPrice.unitPrice, '20'))).toBe(true);
    const cleared = await ctx.call('seller1', 'PUT', `/orders/${id}`, {
      expectedVersion: 2,
      customerCode: customer1,
      negotiationTypeCode: 2,
      notes: null,
      items: [{ productCode: priced[0]?.code, quantity: '2' }],
    });
    expect(cleared.body.items[0].discountPercent).toBe('0');
    expect(decimalEquals(cleared.body.totals.estimatedTotal, computeLineTotal('2', priced[0]?.listPrice.unitPrice))).toBe(true);
  });

  it.each([['100'], ['10.005']])('rejects the well-formed but invalid percentage %j as invalid_discount', async (value) => {
    const response = await create('seller1', discounted(value));
    expect(response.status).toBe(400);
    const issue = response.body.details.issues.find((entry: Json) => entry.code === 'invalid_discount');
    expect(issue?.path).toBe('items[0].discountPercent');
  });

  it.each([['-1'], ['abc'], ['']])('rejects the malformed percentage %j at the contract (validation_failed)', async (value) => {
    const response = await create('seller1', discounted(value));
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('validation_failed');
  });

  it('a quantity problem is still reported as invalid_quantity, not as a discount problem', async () => {
    const response = await create('seller1', draftBody({ items: [{ productCode: priced[0]?.code, quantity: '0', discountPercent: '10' }] }));
    expect(response.status).toBe(400);
    expect(response.body.details.issues.map((issue: Json) => issue.code)).toContain('invalid_quantity');
  });

  it('a discount on a product without a price is refused (there is nothing to discount, P-09)', async () => {
    const permissive: InstallationConfiguration = {
      ...DEMO_CONFIGURATION,
      sales: { ...DEMO_CONFIGURATION.sales, orderBehavior: { allowDraftWithoutPrice: true } },
      products: { ...DEMO_CONFIGURATION.products, productWithoutPrice: { visible: true, orderable: true } },
    };
    const other = await startCommercialApp(postgres, opened, { configuration: permissive });
    const target = (await other.call('manager', 'GET', `/products?customerCode=${customer1}&sellable=true&priceState=none&pageSize=1`)).body.items[0];
    const response = await other.call('seller1', 'POST', '/orders', draftBody({ items: [{ productCode: target.code, quantity: '1', discountPercent: '10' }] }));
    expect(response.status).toBe(400);
    expect(response.body.details.issues.map((issue: Json) => issue.code)).toContain('invalid_discount');
  });

  it('idempotency: the same discount replays (200), another is idempotency_conflict, and an explicit 0 equals no discount', async () => {
    const payload = discounted('10');
    const first = await create('seller1', payload);
    expect(first.status).toBe(201);
    expect((await create('seller1', payload)).status).toBe(200);
    // Equivalent decimal spelling is the same payload.
    const sameValue = await create('seller1', { ...payload, items: [{ ...payload.items[0], discountPercent: '10.00' }, payload.items[1]] });
    expect(sameValue.status).toBe(200);
    const other = await create('seller1', { ...payload, items: [{ ...payload.items[0], discountPercent: '11' }, payload.items[1]] });
    expect(other.status).toBe(409);
    expect(other.body.code).toBe('idempotency_conflict');
    const dropped = await create('seller1', { ...payload, items: [{ productCode: priced[0]?.code, quantity: '2' }, payload.items[1]] });
    expect(dropped.status).toBe(409);
    const plain = draftBody();
    expect((await create('seller1', plain)).status).toBe(201);
    const explicitZero = await create('seller1', { ...plain, items: [{ ...plain.items[0], discountPercent: '0' }, plain.items[1]] });
    expect(explicitZero.status).toBe(200);
  });

  it('audits only how many lines carry a discount, never the percentages or amounts', async () => {
    const created = await create('seller1', discounted('33.33'));
    const rows = (await ctx.database.handle.db.select().from(auditLog)).filter((row) => (row.detail as Json | null)?.orderId === created.body.id);
    const createdRow = rows.find((row) => row.action === 'order.created');
    expect((createdRow?.detail as Json).discountedLineCount).toBe(1);
    expect(JSON.stringify(rows)).not.toContain('33.33');
    // A draft without discounts keeps the previous audit shape.
    const plain = await create('seller1', draftBody());
    const plainRow = (await ctx.database.handle.db.select().from(auditLog)).find(
      (row) => row.action === 'order.created' && (row.detail as Json | null)?.orderId === plain.body.id,
    );
    expect(plainRow?.detail).not.toHaveProperty('discountedLineCount');
  });

  it('the database refuses a percentage outside 0 to 99.99 even if the application did not', async () => {
    const created = await create('seller1', discounted('10'));
    await expect(
      ctx.database.handle.pool.query('update sales_order_item set discount_percent = 100 where order_id = $1', [created.body.id]),
    ).rejects.toThrow(/sales_order_item_discount_percent_chk/);
  });
});
