import { randomUUID } from 'node:crypto';
import {
  OrderDetailSchema,
  OrderTemplateDetailSchema,
  OrderTemplatesResponseSchema,
  UseOrderTemplateResponseSchema,
} from '@salesforce/contracts';
import { auditLog, customerOrderTemplate, salesOrder } from '@salesforce/db';
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

/** Templates and their orders are removed so each test starts from an empty customer. */
async function reset(): Promise<void> {
  await sql('delete from customer_order_template');
  await sql('delete from sales_order');
}

const lines = (...entries: [Json, string][]) => entries.map(([product, quantity]) => ({ productCode: product.code, quantity }));
const uniqueName = (prefix = 'Modelo') => `${prefix} ${randomUUID().slice(0, 8)}`;

const templateBody = (overrides: Record<string, unknown> = {}) => ({
  clientRequestId: randomUUID(),
  name: uniqueName(),
  items: lines([priced[0], '2'], [priced[1], '3.5']),
  ...overrides,
});

const createTemplate = (who: Who, body: unknown, customerCode = customer1) =>
  ctx.call(who, 'POST', `/customers/${customerCode}/order-templates`, body);
const useTemplate = (who: Who, id: string, clientRequestId: string = randomUUID()) =>
  ctx.call(who, 'POST', `/order-templates/${id}/use`, { clientRequestId });

async function makeTemplate(who: Who = 'seller1', overrides: Record<string, unknown> = {}, customerCode = customer1): Promise<Json> {
  const response = await createTemplate(who, templateBody(overrides), customerCode);
  expect(response.status).toBe(201);
  return response.body;
}

describe('create and read', () => {
  it('201: contract-valid detail with canonical quantities, listed and readable', async () => {
    await reset();
    const created = await createTemplate('seller1', templateBody({ name: '  Reposição mensal  ', items: lines([priced[0], '2.0000'], [priced[1], '3.5']) }));
    expect(created.status).toBe(201);
    expect(OrderTemplateDetailSchema.safeParse(created.body).success).toBe(true);
    expect(created.body).toMatchObject({ customerCode: customer1, name: 'Reposição mensal', version: 1, itemCount: 2 });
    expect(created.body.items[0].quantity).toBe('2');

    const listed = await ctx.call('seller1', 'GET', `/customers/${customer1}/order-templates`);
    expect(listed.status).toBe(200);
    expect(OrderTemplatesResponseSchema.safeParse(listed.body).success).toBe(true);
    expect(listed.body.items.map((t: Json) => t.id)).toEqual([created.body.id]);
    expect(listed.body.items[0]).not.toHaveProperty('items');

    const read = await ctx.call('seller1', 'GET', `/order-templates/${created.body.id}`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual(created.body);
  });

  it('a template stores no price and no cost or margin key appears anywhere (P-20, P-09)', async () => {
    await reset();
    const created = await makeTemplate();
    const list = await ctx.call('manager', 'GET', `/customers/${customer1}/order-templates`);
    const detail = await ctx.call('manager', 'GET', `/order-templates/${created.id}`);
    const used = await useTemplate('seller1', created.id);
    for (const body of [created, list.body, detail.body, used.body]) expect(restrictedKeys(body)).toEqual([]);
    expect(JSON.stringify(created)).not.toMatch(/price|preco|preço/i);
  });

  it('list order is by name, case-insensitive', async () => {
    await reset();
    await makeTemplate('seller1', { name: 'banana' });
    await makeTemplate('seller1', { name: 'Cereja' });
    await makeTemplate('seller1', { name: 'ABACAXI' });
    const listed = await ctx.call('seller1', 'GET', `/customers/${customer1}/order-templates`);
    expect(listed.body.items.map((t: Json) => t.name)).toEqual(['ABACAXI', 'banana', 'Cereja']);
  });

  it('a template may hold a product that is not orderable now: it is only revalidated when used', async () => {
    await reset();
    const created = await createTemplate('seller1', templateBody({ items: lines([priced[0], '1'], [unpriced, '1']) }));
    expect(created.status).toBe(201);
    expect(created.body.itemCount).toBe(2);
  });
});

describe('validation', () => {
  it('rejects bad names and lines with stable issue codes and positions (400 validation_failed)', async () => {
    const dup = await createTemplate('seller1', templateBody({ items: lines([priced[0], '1'], [priced[0], '2']) }));
    expect(dup.status).toBe(400);
    expect(dup.body.code).toBe('validation_failed');
    expect(dup.body.details.issues.map((i: Json) => i.code)).toContain('duplicate_product');

    const zero = await createTemplate('seller1', templateBody({ items: lines([priced[0], '0']) }));
    expect(zero.status).toBe(400);
    expect(JSON.stringify(zero.body.details.issues)).toContain('quantity');

    for (const name of ['', '   ', 'x'.repeat(81), 'tab\there']) {
      const bad = await createTemplate('seller1', templateBody({ name }));
      expect(bad.status, JSON.stringify(name)).toBe(400);
      expect(bad.body.code).toBe('validation_failed');
    }
    const noItems = await createTemplate('seller1', templateBody({ items: [] }));
    expect(noItems.status).toBe(400);
  });

  it('rejects a client-sent price or extra field (never silently ignored)', async () => {
    const withPrice = await createTemplate('seller1', templateBody({ items: [{ productCode: priced[0].code, quantity: '1', unitPrice: '0.01' }] }));
    expect(withPrice.status).toBe(400);
    const extra = await createTemplate('seller1', { ...templateBody(), notes: 'x' });
    expect(extra.status).toBe(400);
  });

  it('accepts 500 lines and rejects 501', async () => {
    await reset();
    const many = (count: number) => Array.from({ length: count }, (_, i) => ({ productCode: 900_000 + i, quantity: '1' }));
    const ok = await createTemplate('seller1', templateBody({ items: many(500) }));
    expect(ok.status).toBe(201);
    expect(ok.body.itemCount).toBe(500);
    const tooMany = await createTemplate('seller1', templateBody({ items: many(501) }));
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.code).toBe('validation_failed');
  });

  it('the body caps are enforced before parsing: create/replace 128 kB, use 2 kB', async () => {
    const huge = 'a'.repeat(200 * 1024);
    const created = await createTemplate('seller1', templateBody({ name: huge }));
    expect(created.status).toBe(400);
    expect(created.body.code).toBe('validation_failed');
    const template = await makeTemplate();
    const replaced = await ctx.call('seller1', 'PUT', `/order-templates/${template.id}`, { expectedVersion: 1, name: huge, items: lines([priced[0], '1']) });
    expect(replaced.status).toBe(400);
    const used = await ctx.call('seller1', 'POST', `/order-templates/${template.id}/use`, { clientRequestId: randomUUID(), padding: 'a'.repeat(4 * 1024) });
    expect(used.status).toBe(400);
    expect((await ctx.call('seller1', 'GET', `/order-templates/${template.id}`)).body.version).toBe(1);
  });
});

describe('name uniqueness and limit', () => {
  it('the name is unique per customer, case-insensitively and ignoring outer spaces (409 template_name_taken)', async () => {
    await reset();
    await makeTemplate('seller1', { name: 'Pedido Fixo' });
    for (const name of ['pedido fixo', 'PEDIDO FIXO', '  Pedido Fixo  ']) {
      const clash = await createTemplate('seller1', templateBody({ name }));
      expect(clash.status, name).toBe(409);
      expect(clash.body.code).toBe('conflict');
      expect(clash.body.details.reason).toBe('template_name_taken');
    }
    // Another customer may use the same name.
    const other = await createTemplate('manager', templateBody({ name: 'Pedido Fixo' }), customer2);
    expect(other.status).toBe(201);
  });

  it('a replace onto another live template name is refused; keeping its own name (or its case) is fine', async () => {
    await reset();
    const a = await makeTemplate('seller1', { name: 'Alfa' });
    await makeTemplate('seller1', { name: 'Beta' });
    const clash = await ctx.call('seller1', 'PUT', `/order-templates/${a.id}`, { expectedVersion: 1, name: 'beta', items: lines([priced[0], '1']) });
    expect(clash.status).toBe(409);
    expect(clash.body.details.reason).toBe('template_name_taken');
    const recase = await ctx.call('seller1', 'PUT', `/order-templates/${a.id}`, { expectedVersion: 1, name: 'ALFA', items: lines([priced[0], '1']) });
    expect(recase.status).toBe(200);
    expect(recase.body.name).toBe('ALFA');
  });

  it('a deleted template frees its name', async () => {
    await reset();
    const first = await makeTemplate('seller1', { name: 'Reutilizavel' });
    expect((await ctx.call('seller1', 'DELETE', `/order-templates/${first.id}`)).status).toBe(204);
    const again = await createTemplate('seller1', templateBody({ name: 'Reutilizavel' }));
    expect(again.status).toBe(201);
  });

  it('the 51st live template of a customer is refused (409 template_limit_reached); deleting one makes room', async () => {
    await reset();
    const ids: string[] = [];
    for (let i = 0; i < 50; i += 1) ids.push((await makeTemplate('seller1', { name: `Modelo ${i}` })).id);
    const over = await createTemplate('seller1', templateBody({ name: 'Modelo 50' }));
    expect(over.status).toBe(409);
    expect(over.body.code).toBe('conflict');
    expect(over.body.details.reason).toBe('template_limit_reached');
    // The limit is per customer.
    expect((await createTemplate('manager', templateBody(), customer2)).status).toBe(201);
    expect((await ctx.call('seller1', 'DELETE', `/order-templates/${ids[0]}`)).status).toBe(204);
    expect((await createTemplate('seller1', templateBody({ name: 'Modelo 50' }))).status).toBe(201);
  });

  it('concurrent creates of the same name: exactly one wins', async () => {
    await reset();
    const name = uniqueName('Concorrente');
    const results = await Promise.all([createTemplate('seller1', templateBody({ name })), createTemplate('seller1', templateBody({ name }))]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const rows = await ctx.database.handle.db.select().from(customerOrderTemplate).where(eq(customerOrderTemplate.customerCode, customer1));
    expect(rows).toHaveLength(1);
  });

  it('concurrent creates racing on the last free slot: never more than 50', async () => {
    await reset();
    for (let i = 0; i < 49; i += 1) await makeTemplate('seller1', { name: `Slot ${i}` });
    const results = await Promise.all([1, 2, 3].map((n) => createTemplate('seller1', templateBody({ name: `Corrida ${n}` }))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    const rows = await ctx.database.handle.db.select().from(customerOrderTemplate).where(eq(customerOrderTemplate.customerCode, customer1));
    expect(rows).toHaveLength(50);
  });
});

describe('idempotency (clientRequestId)', () => {
  it('same id and same content: 200 with the original template, one row', async () => {
    await reset();
    const payload = templateBody();
    const first = await createTemplate('seller1', payload);
    const again = await createTemplate('seller1', payload);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    // The same content spelled differently is the same request.
    const spelled = await createTemplate('seller1', { ...payload, name: `  ${payload.name} `, items: [{ ...payload.items[0], quantity: '2.0000' }, payload.items[1]] });
    expect(spelled.status).toBe(200);
    expect(await ctx.database.handle.db.select().from(customerOrderTemplate).where(eq(customerOrderTemplate.clientRequestId, payload.clientRequestId))).toHaveLength(1);
  });

  it('same id with other content: 409 idempotency_conflict, nothing changes', async () => {
    await reset();
    const payload = templateBody();
    const first = await createTemplate('seller1', payload);
    for (const changed of [
      { ...payload, name: uniqueName() },
      { ...payload, items: lines([priced[0], '9'], [priced[1], '3.5']) },
      { ...payload, items: lines([priced[0], '2']) },
    ]) {
      const conflict = await createTemplate('seller1', changed);
      expect(conflict.status).toBe(409);
      expect(conflict.body.code).toBe('idempotency_conflict');
    }
    // The id is scoped to the account (unique per account and request id): another account creates its own template.
    const otherAccount = await createTemplate('manager', payload, customer2);
    expect(otherAccount.status).toBe(201);
    expect(otherAccount.body.id).not.toBe(first.body.id);
    expect((await ctx.call('seller1', 'GET', `/order-templates/${first.body.id}`)).body).toEqual(first.body);
  });

  it('another account reusing the id never sees or replays the template of the first (its own request, its own name check)', async () => {
    await reset();
    const payload = templateBody();
    await createTemplate('seller1', payload);
    const stolen = await createTemplate('manager', payload);
    // Same customer and same name: the ordinary name clash (the caller is in scope of that customer anyway), not a replay.
    expect(stolen.status).toBe(409);
    expect(stolen.body.details.reason).toBe('template_name_taken');
    const renamed = await createTemplate('manager', { ...payload, name: uniqueName() });
    expect(renamed.status).toBe(201);
  });

  it('the same id retried while the first request is running is one template (200 or 201, never a name clash)', async () => {
    await reset();
    const payload = templateBody();
    const results = await Promise.all([createTemplate('seller1', payload), createTemplate('seller1', payload)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(results[0]?.body.id).toBe(results[1]?.body.id);
  });

  it('a replay of a soft-deleted template is idempotency_conflict, never a resurrection', async () => {
    await reset();
    const payload = templateBody();
    const first = await createTemplate('seller1', payload);
    await ctx.call('seller1', 'DELETE', `/order-templates/${first.body.id}`);
    const replay = await createTemplate('seller1', payload);
    expect(replay.status).toBe(409);
    expect(replay.body.code).toBe('idempotency_conflict');
    expect((await ctx.call('seller1', 'GET', `/customers/${customer1}/order-templates`)).body.items).toEqual([]);
  });

  it('a replay after the customer left the caller scope is 404 (the customer is unreachable)', async () => {
    await reset();
    const payload = templateBody();
    await createTemplate('seller1', payload);
    await sql('update erp_customer set seller_code = $1 where code = $2', [SELLER_2, customer1]);
    try {
      const replay = await createTemplate('seller1', payload);
      expect(replay.status).toBe(404);
    } finally {
      await sql('update erp_customer set seller_code = $1 where code = $2', [SELLER_1, customer1]);
    }
  });
});

describe('replace, optimistic concurrency and delete', () => {
  it('replace swaps name and lines, version + 1; a stale expectedVersion is 409 version_conflict', async () => {
    await reset();
    const created = await makeTemplate();
    const replaced = await ctx.call('seller1', 'PUT', `/order-templates/${created.id}`, {
      expectedVersion: 1,
      name: 'Novo nome',
      items: lines([priced[2], '7'], [priced[3], '1.25'], [priced[4], '10']),
    });
    expect(replaced.status).toBe(200);
    expect(OrderTemplateDetailSchema.safeParse(replaced.body).success).toBe(true);
    expect(replaced.body).toMatchObject({ name: 'Novo nome', version: 2, itemCount: 3 });
    expect(replaced.body.items.map((i: Json) => i.productCode)).toEqual([priced[2].code, priced[3].code, priced[4].code]);

    const stale = await ctx.call('seller1', 'PUT', `/order-templates/${created.id}`, { expectedVersion: 1, name: 'Outro', items: lines([priced[0], '1']) });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('version_conflict');
    expect(stale.body.details.currentVersion).toBe(2);
    expect((await ctx.call('seller1', 'GET', `/order-templates/${created.id}`)).body.name).toBe('Novo nome');
  });

  it('replace validates like create (duplicates, 501 lines) and leaves the template intact on failure', async () => {
    await reset();
    const created = await makeTemplate();
    const dup = await ctx.call('seller1', 'PUT', `/order-templates/${created.id}`, { expectedVersion: 1, name: 'x', items: lines([priced[0], '1'], [priced[0], '2']) });
    expect(dup.status).toBe(400);
    const many = Array.from({ length: 501 }, (_, i) => ({ productCode: 900_000 + i, quantity: '1' }));
    expect((await ctx.call('seller1', 'PUT', `/order-templates/${created.id}`, { expectedVersion: 1, name: 'x', items: many })).status).toBe(400);
    const after = await ctx.call('seller1', 'GET', `/order-templates/${created.id}`);
    expect(after.body).toEqual(created);
  });

  it('two racing replaces with the same version: one wins, the other is version_conflict', async () => {
    await reset();
    const created = await makeTemplate();
    const attempt = (name: string) => ctx.call('seller1', 'PUT', `/order-templates/${created.id}`, { expectedVersion: 1, name, items: lines([priced[0], '1']) });
    const results = await Promise.all([attempt('Um'), attempt('Dois')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)?.body.code).toBe('version_conflict');
  });

  it('delete is a soft delete: 204, then gone for read, list, replace, use and a second delete', async () => {
    await reset();
    const created = await makeTemplate();
    expect((await ctx.call('seller1', 'DELETE', `/order-templates/${created.id}`)).status).toBe(204);
    expect((await ctx.call('seller1', 'GET', `/order-templates/${created.id}`)).status).toBe(404);
    expect((await ctx.call('seller1', 'GET', `/customers/${customer1}/order-templates`)).body.items).toEqual([]);
    expect((await ctx.call('seller1', 'PUT', `/order-templates/${created.id}`, { expectedVersion: 2, name: 'x', items: lines([priced[0], '1']) })).status).toBe(404);
    expect((await useTemplate('seller1', created.id)).status).toBe(404);
    expect((await ctx.call('seller1', 'DELETE', `/order-templates/${created.id}`)).status).toBe(404);
    const [row] = await ctx.database.handle.db.select().from(customerOrderTemplate).where(eq(customerOrderTemplate.id, created.id));
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.version).toBe(2);
  });
});

describe('scope (P-21): out of scope is always 404, the same as a missing resource', () => {
  it('a seller cannot list, create, read, replace, delete or use a template of another seller customer', async () => {
    await reset();
    const foreign = await makeTemplate('manager', {}, customer2);
    const missing = randomUUID();
    const missingRead = await ctx.call('seller1', 'GET', `/order-templates/${missing}`);

    const reads = [
      ctx.call('seller1', 'GET', `/customers/${customer2}/order-templates`),
      createTemplate('seller1', templateBody(), customer2),
      ctx.call('seller1', 'GET', `/order-templates/${foreign.id}`),
      ctx.call('seller1', 'PUT', `/order-templates/${foreign.id}`, { expectedVersion: 1, name: 'x', items: lines([priced[0], '1']) }),
      ctx.call('seller1', 'DELETE', `/order-templates/${foreign.id}`),
      useTemplate('seller1', foreign.id),
    ];
    for (const response of await Promise.all(reads)) {
      expect(response.status).toBe(404);
      expect(response.body.code).toBe(missingRead.body.code);
      expect(response.body.message).toBe(missingRead.body.message);
    }
    // Nothing changed.
    const [row] = await ctx.database.handle.db.select().from(customerOrderTemplate).where(eq(customerOrderTemplate.id, foreign.id));
    expect(row).toMatchObject({ version: 1, deletedAt: null });
    expect(await ctx.database.handle.db.select().from(customerOrderTemplate).where(eq(customerOrderTemplate.customerCode, customer2))).toHaveLength(1);
    expect(await ctx.database.handle.db.select().from(salesOrder).where(eq(salesOrder.customerCode, customer2))).toHaveLength(0);
  });

  it('an unknown customer is 404 exactly like a foreign one', async () => {
    const unknown = await ctx.call('seller1', 'GET', '/customers/2000000000/order-templates');
    const foreign = await ctx.call('seller1', 'GET', `/customers/${customer2}/order-templates`);
    expect(unknown.status).toBe(404);
    expect({ ...unknown.body, details: undefined }).toEqual({ ...foreign.body, details: undefined });
  });

  it('managers and admins reach any customer; two sellers of the same customer share its templates (assumption)', async () => {
    await reset();
    const created = await makeTemplate('seller1');
    for (const who of ['manager', 'admin'] as const) expect((await ctx.call(who, 'GET', `/order-templates/${created.id}`)).status).toBe(200);
    expect((await ctx.call('seller2', 'GET', `/order-templates/${created.id}`)).status).toBe(404);
    const foreign = await makeTemplate('admin', {}, customer2);
    expect((await ctx.call('seller2', 'GET', `/order-templates/${foreign.id}`)).status).toBe(200);
  });

  it('a customer reassigned to another seller: the previous seller gets 404 on everything, the new one sees the templates', async () => {
    await reset();
    const created = await makeTemplate('seller1');
    await sql('update erp_customer set seller_code = $1 where code = $2', [SELLER_2, customer1]);
    try {
      expect((await ctx.call('seller1', 'GET', `/order-templates/${created.id}`)).status).toBe(404);
      expect((await ctx.call('seller1', 'GET', `/customers/${customer1}/order-templates`)).status).toBe(404);
      expect((await ctx.call('seller1', 'PUT', `/order-templates/${created.id}`, { expectedVersion: 1, name: 'x', items: lines([priced[0], '1']) })).status).toBe(404);
      expect((await ctx.call('seller1', 'DELETE', `/order-templates/${created.id}`)).status).toBe(404);
      expect((await useTemplate('seller1', created.id)).status).toBe(404);
      expect((await createTemplate('seller1', templateBody())).status).toBe(404);
      expect((await ctx.call('seller2', 'GET', `/order-templates/${created.id}`)).status).toBe(200);
    } finally {
      await sql('update erp_customer set seller_code = $1 where code = $2', [SELLER_1, customer1]);
    }
    expect((await ctx.call('seller1', 'GET', `/order-templates/${created.id}`)).body.version).toBe(1);
  });

  it('a removed customer hides its templates from everyone', async () => {
    await reset();
    const created = await makeTemplate('seller1');
    await sql('update erp_customer set deleted_at = now() where code = $1', [customer1]);
    try {
      for (const who of ['seller1', 'manager', 'admin'] as const) {
        expect((await ctx.call(who, 'GET', `/order-templates/${created.id}`)).status, who).toBe(404);
        expect((await useTemplate(who, created.id)).status, who).toBe(404);
      }
    } finally {
      await sql('update erp_customer set deleted_at = null where code = $1', [customer1]);
    }
  });
});

describe('use: a new independent draft through the same code path as createOrder', () => {
  it('201: a draft priced by the server, contract-valid, no negotiation type, nothing skipped', async () => {
    await reset();
    const template = await makeTemplate('seller1');
    const clientRequestId = randomUUID();
    const used = await useTemplate('seller1', template.id, clientRequestId);
    expect(used.status).toBe(201);
    expect(UseOrderTemplateResponseSchema.safeParse(used.body).success).toBe(true);
    expect(OrderDetailSchema.safeParse(used.body.order).success).toBe(true);
    expect(used.body.skippedLines).toEqual([]);
    expect(used.body.order).toMatchObject({ status: 'draft', version: 1, customerCode: customer1, sellerCode: SELLER_1, negotiationTypeCode: null, notes: null });
    expect(used.body.order.items.map((i: Json) => [i.productCode, i.quantity])).toEqual([
      [priced[0].code, '2'],
      [priced[1].code, '3.5'],
    ]);
    for (const item of used.body.order.items) expect(item.priceState).toBe('priced');
    expect(restrictedKeys(used.body)).toEqual([]);
    const [row] = await ctx.database.handle.db.select().from(salesOrder).where(eq(salesOrder.clientRequestId, clientRequestId));
    expect(row?.status).toBe('draft');
  });

  it('the price is the current list price, not one stored with the template', async () => {
    await reset();
    const template = await makeTemplate('seller1');
    const before = await useTemplate('seller1', template.id);
    const price = before.body.order.items[0].unitListPrice;
    expect(price).toBe(priced[0].listPrice.unitPrice);
    expect(template.items[0]).not.toHaveProperty('unitPrice');
  });

  it('the order and the template are independent: editing or deleting one never touches the other', async () => {
    await reset();
    const template = await makeTemplate('seller1');
    const used = await useTemplate('seller1', template.id);
    const orderId = used.body.order.id;

    // Edit the order: the template is unchanged.
    const edited = await ctx.call('seller1', 'PUT', `/orders/${orderId}`, {
      expectedVersion: 1,
      customerCode: customer1,
      negotiationTypeCode: 2,
      notes: 'editado',
      items: lines([priced[4], '99']),
    });
    expect(edited.status).toBe(200);
    expect((await ctx.call('seller1', 'GET', `/order-templates/${template.id}`)).body).toEqual(template);

    // Edit the template: the order is unchanged.
    const orderBefore = (await ctx.call('seller1', 'GET', `/orders/${orderId}`)).body;
    expect((await ctx.call('seller1', 'PUT', `/order-templates/${template.id}`, { expectedVersion: 1, name: 'Mudou', items: lines([priced[3], '1']) })).status).toBe(200);
    expect((await ctx.call('seller1', 'GET', `/orders/${orderId}`)).body).toEqual(orderBefore);

    // Discard the order: the template stays; delete the template: another order stays.
    expect((await ctx.call('seller1', 'DELETE', `/orders/${orderId}`)).status).toBe(200);
    expect((await ctx.call('seller1', 'GET', `/order-templates/${template.id}`)).status).toBe(200);
    const second = await useTemplate('seller1', template.id);
    expect((await ctx.call('seller1', 'DELETE', `/order-templates/${template.id}`)).status).toBe(204);
    const secondAfter = await ctx.call('seller1', 'GET', `/orders/${second.body.order.id}`);
    expect(secondAfter.status).toBe(200);
    expect(secondAfter.body.status).toBe('draft');
    expect(secondAfter.body.items).toHaveLength(1); // made after the template was edited
  });

  it('using twice with two clientRequestIds makes two distinct orders', async () => {
    await reset();
    const template = await makeTemplate('seller1');
    const first = await useTemplate('seller1', template.id);
    const second = await useTemplate('seller1', template.id);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(first.body.order.id).not.toBe(second.body.order.id);
    expect(await ctx.database.handle.db.select().from(salesOrder).where(eq(salesOrder.customerCode, customer1))).toHaveLength(2);
  });

  it('replaying the same clientRequestId returns the same order (200), not a third one', async () => {
    await reset();
    const template = await makeTemplate('seller1');
    const clientRequestId = randomUUID();
    const first = await useTemplate('seller1', template.id, clientRequestId);
    const replay = await useTemplate('seller1', template.id, clientRequestId);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.order).toEqual(first.body.order);
    expect(await ctx.database.handle.db.select().from(salesOrder).where(eq(salesOrder.clientRequestId, clientRequestId))).toHaveLength(1);
    // Audit: one use event per created order, not per replay.
    const used = (await ctx.database.handle.db.select().from(auditLog)).filter(
      (row) => row.action === 'order_template.used' && (row.detail as Json).orderId === first.body.order.id,
    );
    expect(used).toHaveLength(1);
  });

  it('the same clientRequestId reused for another template is idempotency_conflict', async () => {
    await reset();
    const a = await makeTemplate('seller1', { name: 'A' });
    const b = await makeTemplate('seller1', { name: 'B', items: lines([priced[3], '4']) });
    const clientRequestId = randomUUID();
    expect((await useTemplate('seller1', a.id, clientRequestId)).status).toBe(201);
    const conflict = await useTemplate('seller1', b.id, clientRequestId);
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('idempotency_conflict');
  });

  it('lines that cannot be ordered now are left out and reported; the rest is drafted', async () => {
    await reset();
    const template = await makeTemplate('seller1', {
      items: lines([priced[0], '1'], [priced[2], '2'], [priced[3], '3'], [unpriced, '4'], [{ code: 1 }, '5']),
    });
    await sql('update erp_product set active = false where code = $1', [priced[2].code]);
    await sql('update erp_product set deleted_at = now() where code = $1', [priced[3].code]);
    try {
      const used = await useTemplate('seller1', template.id);
      expect(used.status).toBe(201);
      expect(used.body.order.items.map((i: Json) => i.productCode)).toEqual([priced[0].code]);
      const reasons = Object.fromEntries(used.body.skippedLines.map((s: Json) => [s.productCode, s.reason]));
      expect(reasons[priced[2].code]).toBe('product_inactive');
      expect(reasons[priced[3].code]).toBe('product_removed');
      expect(reasons[unpriced.code]).toBe('no_price');
      expect(reasons[1]).toBe('product_removed');
      expect(used.body.skippedLines.map((s: Json) => s.lineNo)).toEqual([2, 3, 4, 5]);
      // Nothing about a skipped product beyond its code and the reason.
      expect(Object.keys(used.body.skippedLines[0]).sort()).toEqual(['lineNo', 'productCode', 'reason']);
      // A missing price is never drafted as 0.
      expect(JSON.stringify(used.body.order)).not.toContain(String(unpriced.code) + ',');
      // The template itself is untouched.
      expect((await ctx.call('seller1', 'GET', `/order-templates/${template.id}`)).body.itemCount).toBe(5);
    } finally {
      await sql('update erp_product set active = true where code = $1', [priced[2].code]);
      await sql('update erp_product set deleted_at = null where code = $1', [priced[3].code]);
    }
  });

  it('with no usable line nothing is created: 409 conflict no_usable_lines listing every skipped line', async () => {
    await reset();
    const template = await makeTemplate('seller1', { items: lines([unpriced, '1'], [priced[2], '1']) });
    await sql('update erp_product set active = false where code = $1', [priced[2].code]);
    try {
      const before = await ctx.database.handle.db.select().from(salesOrder).where(eq(salesOrder.customerCode, customer1));
      const used = await useTemplate('seller1', template.id);
      expect(used.status).toBe(409);
      expect(used.body.code).toBe('conflict');
      expect(used.body.details.reason).toBe('no_usable_lines');
      expect(used.body.details.skippedLines).toHaveLength(2);
      const after = await ctx.database.handle.db.select().from(salesOrder).where(eq(salesOrder.customerCode, customer1));
      expect(after).toHaveLength(before.length);
    } finally {
      await sql('update erp_product set active = true where code = $1', [priced[2].code]);
    }
  });

  it('a product that is not sellable reads as removed to a seller (no probing) and as itself to the admin', async () => {
    await reset();
    const template = await makeTemplate('seller1', { items: lines([priced[0], '1'], [priced[2], '2']) });
    const original = (await sql('select usage_code from erp_product where code = $1', [priced[2].code])).rows[0].usage_code;
    await sql(`update erp_product set usage_code = 'ZZ-NOT-SELLABLE' where code = $1`, [priced[2].code]);
    try {
      const seller = await useTemplate('seller1', template.id);
      expect(seller.status).toBe(201);
      expect(seller.body.skippedLines).toEqual([{ lineNo: 2, productCode: priced[2].code, reason: 'product_removed' }]);
      const admin = await useTemplate('admin', template.id);
      expect(admin.body.skippedLines).toEqual([{ lineNo: 2, productCode: priced[2].code, reason: 'product_not_sellable' }]);
    } finally {
      await sql('update erp_product set usage_code = $2 where code = $1', [priced[2].code, original]);
    }
  });

  it('a template edited between the read and the lock is not used with stale lines (version_conflict, no order)', async () => {
    await reset();
    const template = await makeTemplate('seller1');
    const before = await ctx.database.handle.db.select().from(salesOrder).where(eq(salesOrder.customerCode, customer1));
    // Bump the version right after the service has read the template: the lock-time version check must refuse.
    const [used, edited] = await Promise.all([
      useTemplate('seller1', template.id),
      ctx.call('seller1', 'PUT', `/order-templates/${template.id}`, {
        expectedVersion: 1,
        name: uniqueName(),
        items: lines([priced[3], '9']),
      }),
    ]);
    expect(edited.status).toBe(200);
    const after = await ctx.database.handle.db.select().from(salesOrder).where(eq(salesOrder.customerCode, customer1));
    // The use either read after the edit (201, new lines), won the lock first (201, old lines) or lost it (409, no order): never stale lines under the new version.
    if (used.status === 201) {
      // The order carries a whole version of the template (old lines or new ones), never a mix.
      const codes = used.body.order.items.map((i: Json) => i.productCode).sort();
      expect([[priced[0].code, priced[1].code].sort(), [priced[3].code]]).toContainEqual(codes);
      expect(after).toHaveLength(before.length + 1);
    } else {
      expect(used.status).toBe(409);
      expect(used.body.code).toBe('version_conflict');
      expect(after).toHaveLength(before.length);
    }
  });

  it('a template that is deleted while its order is being made yields 404 and no order (lock-time race)', async () => {
    await reset();
    const template = await makeTemplate('seller1');
    const clientRequestId = randomUUID();
    const [deleted, used] = await Promise.all([
      ctx.call('seller1', 'DELETE', `/order-templates/${template.id}`),
      useTemplate('seller1', template.id, clientRequestId),
    ]);
    expect(deleted.status).toBe(204);
    // Either the use won (201) before the delete, or lost (404): never a draft from a deleted template afterwards.
    expect([201, 404]).toContain(used.status);
    const orders = await ctx.database.handle.db.select().from(salesOrder).where(eq(salesOrder.clientRequestId, clientRequestId));
    expect(orders).toHaveLength(used.status === 201 ? 1 : 0);
    expect((await useTemplate('seller1', template.id)).status).toBe(404);
  });

  it('using a soft-deleted template is 404 and a replay of an earlier use is unaffected by the delete only if the template is live', async () => {
    await reset();
    const template = await makeTemplate('seller1');
    const clientRequestId = randomUUID();
    expect((await useTemplate('seller1', template.id, clientRequestId)).status).toBe(201);
    await ctx.call('seller1', 'DELETE', `/order-templates/${template.id}`);
    expect((await useTemplate('seller1', template.id, clientRequestId)).status).toBe(404);
  });
});

describe('audit', () => {
  it('records identifiers and counts only: no template name, product code, quantity or note', async () => {
    await reset();
    const name = `Segredo ${randomUUID()}`;
    const template = await makeTemplate('seller1', { name });
    await ctx.call('seller1', 'PUT', `/order-templates/${template.id}`, { expectedVersion: 1, name: `${name} v2`, items: lines([priced[0], '11']) });
    await useTemplate('seller1', template.id);
    await ctx.call('seller1', 'DELETE', `/order-templates/${template.id}`);

    const rows = (await ctx.database.handle.db.select().from(auditLog)).filter(
      (row) => row.action.startsWith('order_template.') && (row.detail as Json).templateId === template.id,
    );
    expect(rows.map((row) => row.action).sort()).toEqual([
      'order_template.created',
      'order_template.deleted',
      'order_template.replaced',
      'order_template.used',
    ]);
    const serialized = JSON.stringify(rows.map((row) => row.detail));
    expect(serialized).not.toContain('Segredo');
    expect(serialized).not.toContain('quantity');
    expect(serialized).not.toContain('productCode');
    const usedRow = rows.find((row) => row.action === 'order_template.used');
    expect(usedRow?.detail).toMatchObject({ templateId: template.id, customerCode: customer1, usedCount: 1, skippedCount: 0 });
  });
});
