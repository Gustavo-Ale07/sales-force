import { randomUUID } from 'node:crypto';
import { OrderDetailSchema, RepeatLastOrderResponseSchema } from '@salesforce/contracts';
import { auditLog, salesOrder } from '@salesforce/db';
import { getDemoDataset } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { restrictedKeys, startCommercialApp, type CommercialApp, type Json, type Who } from '../helpers/commercial-app.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

const dataset = getDemoDataset();
const SELLER_1 = 103;
const SELLER_2 = 107;

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let ctx: CommercialApp;

let customer1: number; // seller 103
let customer2: number; // seller 107
let priced: Json[]; // sellable products with a price for customer1
let unpriced: Json; // sellable product with no price for customer1

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
  priced = (await list('sellable=true&priceState=priced')).slice(0, 6);
  unpriced = (await list('sellable=true&priceState=none'))[0];
  if (priced.length < 5 || unpriced === undefined) throw new Error('fixture lacks products');
});

afterAll(async () => {
  for (const close of opened.reverse()) await close();
  await postgres.stop();
});

const sql = (text: string, params: unknown[] = []) => ctx.database.handle.pool.query(text, params);

/** Every order of the customer is removed so each test starts from a clean order history. */
async function reset(): Promise<void> {
  await sql('delete from sales_order');
}

const lines = (...entries: [Json, string][]) => entries.map(([product, quantity]) => ({ productCode: product.code, quantity }));

const draftBody = (overrides: Record<string, unknown> = {}, customerCode = customer1) => ({
  clientRequestId: randomUUID(),
  customerCode,
  negotiationTypeCode: 2,
  notes: 'pedido de teste',
  items: lines([priced[0], '2'], [priced[1], '3.5']),
  ...overrides,
});

const createOrder = (who: Who, body: unknown) => ctx.call(who, 'POST', '/orders', body);
const repeatLast = (who: Who, customerCode: number, clientRequestId: string = randomUUID()) =>
  ctx.call(who, 'POST', `/customers/${customerCode}/orders/repeat-last`, { clientRequestId });

async function makeOrder(who: Who = 'seller1', overrides: Record<string, unknown> = {}, customerCode = customer1): Promise<Json> {
  const response = await createOrder(who, draftBody(overrides, customerCode));
  expect(response.status).toBe(201);
  return response.body;
}

describe('repeat last order: a new independent draft from the customer\'s most recent non-cancelled order', () => {
  it('201: copies productCode and quantity only, contract-valid, nothing skipped', async () => {
    await reset();
    await makeOrder('seller1', { items: lines([priced[0], '2'], [priced[1], '3.5']) });
    const clientRequestId = randomUUID();
    const repeated = await repeatLast('seller1', customer1, clientRequestId);
    expect(repeated.status).toBe(201);
    expect(RepeatLastOrderResponseSchema.safeParse(repeated.body).success).toBe(true);
    expect(OrderDetailSchema.safeParse(repeated.body.order).success).toBe(true);
    expect(repeated.body.skippedLines).toEqual([]);
    expect(repeated.body.order).toMatchObject({ status: 'draft', version: 1, customerCode: customer1, sellerCode: SELLER_1, negotiationTypeCode: null, notes: null });
    expect(repeated.body.order.items.map((i: Json) => [i.productCode, i.quantity])).toEqual([
      [priced[0].code, '2'],
      [priced[1].code, '3.5'],
    ]);
    const [row] = await ctx.database.handle.db.select().from(salesOrder).where(eq(salesOrder.clientRequestId, clientRequestId));
    expect(row?.status).toBe('draft');
  });

  it('never copies negotiationTypeCode or notes from the source order', async () => {
    await reset();
    await makeOrder('seller1', { negotiationTypeCode: 2, notes: 'nota original' });
    const repeated = await repeatLast('seller1', customer1);
    expect(repeated.body.order.negotiationTypeCode).toBeNull();
    expect(repeated.body.order.notes).toBeNull();
  });

  it('uses the most recent NON-cancelled order: a later cancelled order is ignored', async () => {
    await reset();
    const older = await makeOrder('seller1', { items: lines([priced[0], '1']) });
    const newer = await makeOrder('seller1', { items: lines([priced[1], '9']) });
    expect((await ctx.call('seller1', 'DELETE', `/orders/${newer.id}`)).status).toBe(200); // discard -> cancelled
    const repeated = await repeatLast('seller1', customer1);
    expect(repeated.status).toBe(201);
    expect(repeated.body.order.items.map((i: Json) => i.productCode)).toEqual([priced[0].code]);
    void older;
  });

  it('the price is the current list price, not one stored with the source order', async () => {
    await reset();
    const source = await makeOrder('seller1');
    const repeated = await repeatLast('seller1', customer1);
    expect(repeated.body.order.items[0].unitListPrice).toBe(priced[0].listPrice.unitPrice);
    expect(repeated.body.order.id).not.toBe(source.id);
  });

  it('the new draft is assigned to the CURRENT seller, which may differ from the source order seller', async () => {
    // Order visibility of the source itself follows the seller recorded at its own draft time (P-21,
    // orders.repository scopeCondition), so this is exercised with a scope-'all' role (manager) that
    // reaches the source order regardless of which seller it was recorded under.
    await reset();
    await makeOrder('seller1');
    await sql('update erp_customer set seller_code = $1 where code = $2', [SELLER_2, customer1]);
    try {
      const repeated = await repeatLast('manager', customer1);
      expect(repeated.status).toBe(201);
      expect(repeated.body.order.sellerCode).toBe(SELLER_2);
    } finally {
      await sql('update erp_customer set seller_code = $1 where code = $2', [SELLER_1, customer1]);
    }
  });

  it('the source order is never touched: editing or discarding the new draft leaves it intact', async () => {
    await reset();
    const source = await makeOrder('seller1');
    const repeated = await repeatLast('seller1', customer1);
    const newId = repeated.body.order.id;

    const edited = await ctx.call('seller1', 'PUT', `/orders/${newId}`, {
      expectedVersion: 1,
      customerCode: customer1,
      negotiationTypeCode: 2,
      notes: 'editado',
      items: lines([priced[4], '99']),
    });
    expect(edited.status).toBe(200);
    const sourceAfter = await ctx.call('seller1', 'GET', `/orders/${source.id}`);
    expect(sourceAfter.body).toEqual(source);

    expect((await ctx.call('seller1', 'DELETE', `/orders/${newId}`)).status).toBe(200);
    const sourceAfterDiscard = await ctx.call('seller1', 'GET', `/orders/${source.id}`);
    expect(sourceAfterDiscard.body).toEqual(source);
  });

  it('no cost, margin or price key from the template/source leaks: strict keys everywhere', async () => {
    await reset();
    await makeOrder('seller1');
    const repeated = await repeatLast('seller1', customer1);
    expect(restrictedKeys(repeated.body)).toEqual([]);
  });

  it('409 conflict no_previous_order when the customer has no order in Sales Force at all', async () => {
    await reset();
    const response = await repeatLast('seller1', customer1);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('conflict');
    expect(response.body.details.reason).toBe('no_previous_order');
  });

  it('409 conflict no_previous_order when every order of the customer is cancelled', async () => {
    await reset();
    const order = await makeOrder('seller1');
    expect((await ctx.call('seller1', 'DELETE', `/orders/${order.id}`)).status).toBe(200);
    const response = await repeatLast('seller1', customer1);
    expect(response.status).toBe(409);
    expect(response.body.details.reason).toBe('no_previous_order');
  });

  // Unlike a template, an order line is validated against the catalog at creation time (`DraftBuilder.build`),
  // so the source order below is built only from lines that ARE orderable when created; each becomes
  // unusable only afterwards (inactive / removed / no longer priced), which is what `repeatLast` re-checks.
  it('lines that cannot be ordered now are left out and reported; the rest is drafted', async () => {
    await reset();
    await makeOrder('seller1', {
      items: lines([priced[0], '1'], [priced[2], '2'], [priced[3], '3'], [priced[5], '4']),
    });
    await sql('update erp_product set active = false where code = $1', [priced[2].code]);
    await sql('update erp_product set deleted_at = now() where code = $1', [priced[3].code]);
    await sql('update erp_list_price set deleted_at = now() where product_code = $1', [priced[5].code]);
    try {
      const repeated = await repeatLast('seller1', customer1);
      expect(repeated.status).toBe(201);
      expect(repeated.body.order.items.map((i: Json) => i.productCode)).toEqual([priced[0].code]);
      const reasons = Object.fromEntries(repeated.body.skippedLines.map((s: Json) => [s.productCode, s.reason]));
      expect(reasons[priced[2].code]).toBe('product_inactive');
      expect(reasons[priced[3].code]).toBe('product_removed');
      expect(reasons[priced[5].code]).toBe('no_price');
      expect(repeated.body.skippedLines.map((s: Json) => s.lineNo)).toEqual([2, 3, 4]);
      expect(Object.keys(repeated.body.skippedLines[0]).sort()).toEqual(['lineNo', 'productCode', 'reason']);
    } finally {
      await sql('update erp_product set active = true where code = $1', [priced[2].code]);
      await sql('update erp_product set deleted_at = null where code = $1', [priced[3].code]);
      await sql('update erp_list_price set deleted_at = null where product_code = $1', [priced[5].code]);
    }
  });

  it('409 conflict no_usable_lines lists every skipped line and creates nothing', async () => {
    await reset();
    await makeOrder('seller1', { items: lines([priced[2], '1'], [priced[3], '1']) });
    await sql('update erp_product set active = false where code = $1', [priced[2].code]);
    await sql('update erp_product set deleted_at = now() where code = $1', [priced[3].code]);
    try {
      const before = await ctx.database.handle.db.select().from(salesOrder).where(eq(salesOrder.customerCode, customer1));
      const repeated = await repeatLast('seller1', customer1);
      expect(repeated.status).toBe(409);
      expect(repeated.body.code).toBe('conflict');
      expect(repeated.body.details.reason).toBe('no_usable_lines');
      expect(repeated.body.details.skippedLines).toHaveLength(2);
      const after = await ctx.database.handle.db.select().from(salesOrder).where(eq(salesOrder.customerCode, customer1));
      expect(after).toHaveLength(before.length);
    } finally {
      await sql('update erp_product set active = true where code = $1', [priced[2].code]);
      await sql('update erp_product set deleted_at = null where code = $1', [priced[3].code]);
    }
  });

  it('a product that is not sellable reads as removed to a seller (no probing) and as itself to the admin', async () => {
    // Two different customers, each with its own fresh source order created while the product is still
    // sellable: `repeatLast` itself creates a new order, so reusing one customer for both calls would make
    // the second call repeat the first call's (already-filtered) draft instead of the original source.
    await reset();
    await makeOrder('seller1', { items: lines([priced[0], '1'], [priced[2], '2']) }, customer1);
    await makeOrder('manager', { items: lines([priced[0], '1'], [priced[2], '2']) }, customer2);
    const original = (await sql('select usage_code from erp_product where code = $1', [priced[2].code])).rows[0].usage_code;
    await sql(`update erp_product set usage_code = 'ZZ-NOT-SELLABLE' where code = $1`, [priced[2].code]);
    try {
      const seller = await repeatLast('seller1', customer1);
      expect(seller.status).toBe(201);
      expect(seller.body.skippedLines).toEqual([{ lineNo: 2, productCode: priced[2].code, reason: 'product_removed' }]);
      const admin = await repeatLast('admin', customer2);
      expect(admin.status).toBe(201);
      expect(admin.body.skippedLines).toEqual([{ lineNo: 2, productCode: priced[2].code, reason: 'product_not_sellable' }]);
    } finally {
      await sql('update erp_product set usage_code = $2 where code = $1', [priced[2].code, original]);
    }
  });

  describe('idempotency (clientRequestId)', () => {
    it('same id: 200 with the original draft, one row (no double order on double click)', async () => {
      await reset();
      await makeOrder('seller1');
      const clientRequestId = randomUUID();
      const first = await repeatLast('seller1', customer1, clientRequestId);
      const again = await repeatLast('seller1', customer1, clientRequestId);
      expect(first.status).toBe(201);
      expect(again.status).toBe(200);
      expect(again.body).toEqual(first.body);
      expect(await ctx.database.handle.db.select().from(salesOrder).where(eq(salesOrder.clientRequestId, clientRequestId))).toHaveLength(1);
    });

    it('two clientRequestIds make two distinct drafts from the same source order', async () => {
      await reset();
      await makeOrder('seller1');
      const first = await repeatLast('seller1', customer1);
      const second = await repeatLast('seller1', customer1);
      expect([first.status, second.status]).toEqual([201, 201]);
      expect(first.body.order.id).not.toBe(second.body.order.id);
    });

    it('concurrent requests with the same id race to exactly one draft (200 or 201, never a duplicate)', async () => {
      await reset();
      await makeOrder('seller1');
      const clientRequestId = randomUUID();
      const results = await Promise.all([repeatLast('seller1', customer1, clientRequestId), repeatLast('seller1', customer1, clientRequestId)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
      expect(results[0]?.body.order.id).toBe(results[1]?.body.order.id);
      expect(await ctx.database.handle.db.select().from(salesOrder).where(eq(salesOrder.clientRequestId, clientRequestId))).toHaveLength(1);
    });

    // The idempotency check must run before "latest order" is resolved and its lines reclassified:
    // both depend on mutable state, so a retry landing after that state shifted must still replay the
    // original draft, never re-derive a different item set nor surface no_previous_order/no_usable_lines.
    it('a retry still returns the original draft even after the source order and catalog have shifted since the first call', async () => {
      await reset();
      const source = await makeOrder('seller1', { items: lines([priced[0], '2'], [priced[1], '3.5']) });
      const clientRequestId = randomUUID();
      const first = await repeatLast('seller1', customer1, clientRequestId);
      expect(first.status).toBe(201);

      // Shift the state that a fresh repeat-last call would resolve differently: cancel the very
      // source order used for the first call (so "latest non-cancelled order" would now resolve to
      // nothing, or to the repeated draft itself) and make one of its products unsellable.
      expect((await ctx.call('seller1', 'DELETE', `/orders/${source.id}`)).status).toBe(200);
      await sql('update erp_product set active = false where code = $1', [priced[0].code]);
      try {
        const retry = await repeatLast('seller1', customer1, clientRequestId);
        expect(retry.status).toBe(200);
        expect(retry.body).toEqual(first.body);
        expect(retry.body.order.id).toBe(first.body.order.id);
        expect(await ctx.database.handle.db.select().from(salesOrder).where(eq(salesOrder.clientRequestId, clientRequestId))).toHaveLength(1);
      } finally {
        await sql('update erp_product set active = true where code = $1', [priced[0].code]);
      }
    });

    it('a retry that would have no previous order left at all (its own source cancelled, nothing else) still replays instead of 409 no_previous_order', async () => {
      await reset();
      const source = await makeOrder('seller1');
      const clientRequestId = randomUUID();
      const first = await repeatLast('seller1', customer1, clientRequestId);
      expect(first.status).toBe(201);
      expect((await ctx.call('seller1', 'DELETE', `/orders/${source.id}`)).status).toBe(200);
      expect((await ctx.call('seller1', 'DELETE', `/orders/${first.body.order.id}`)).status).toBe(200);

      const retry = await repeatLast('seller1', customer1, clientRequestId);
      expect(retry.status).toBe(200);
      expect(retry.body.order.id).toBe(first.body.order.id);
      // The replayed draft still reads as cancelled: repeat-last never resurrects or re-derives it.
      expect(retry.body.order.status).toBe('cancelled');
    });
  });

  describe('scope (P-21): out of scope is always 404, the same as a missing customer', () => {
    it('a seller cannot repeat the last order of another seller customer', async () => {
      await reset();
      await makeOrder('manager', {}, customer2);
      const foreign = await repeatLast('seller1', customer2);
      expect(foreign.status).toBe(404);
      expect(foreign.body.code).toBe('not_found');
      // Nothing created for the foreign customer.
      expect(await ctx.database.handle.db.select().from(salesOrder).where(eq(salesOrder.customerCode, customer2))).toHaveLength(1);
    });

    it('an unknown customer is 404, not a validation error', async () => {
      const response = await repeatLast('seller1', 2_000_000_000);
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('not_found');
    });

    it('managers and admins reach any customer', async () => {
      await reset();
      await makeOrder('seller1');
      for (const who of ['manager', 'admin'] as const) expect((await repeatLast(who, customer1)).status).toBe(201);
    });
  });

  describe('audit', () => {
    it('records identifiers and counts only: no product code, quantity or note', async () => {
      await reset();
      const source = await makeOrder('seller1', { notes: 'Segredo do pedido' });
      const repeated = await repeatLast('seller1', customer1);
      const rows = (await ctx.database.handle.db.select().from(auditLog)).filter(
        (row) => row.action === 'order.repeated_from_last' && (row.detail as Json).orderId === repeated.body.order.id,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.detail).toMatchObject({
        sourceOrderId: source.id,
        orderId: repeated.body.order.id,
        customerCode: customer1,
        usedCount: 2,
        skippedCount: 0,
      });
      const serialized = JSON.stringify(rows.map((row) => row.detail));
      expect(serialized).not.toContain('Segredo');
      expect(serialized).not.toContain('quantity');
      expect(serialized).not.toContain('productCode');
    });
  });
});
