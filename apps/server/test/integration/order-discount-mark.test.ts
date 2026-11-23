import { randomUUID } from 'node:crypto';
import { OrderDetailSchema, OrderListItemSchema } from '@salesforce/contracts';
import { auditLog, salesOrder } from '@salesforce/db';
import { getDemoDataset } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { startPostgres, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

/**
 * `discountAboveLimitAccepted`: an informational mark ("the seller confirmed a discount above the product limit").
 * Optional on create/replace (absent = false on create, unchanged on replace), returned by the detail and the list,
 * audited, and NEVER a gate: no state or submit outcome depends on it.
 */
const dataset = getDemoDataset();
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let app: CommercialApp;
let customerCode: number;
let products: Json[];

beforeAll(async () => {
  postgres = await startPostgres();
  app = await startCommercialApp(postgres, opened);
  const c = dataset.customers.find((x) => x.sellerCode === 103 && x.active && !x.blocked && x.priceTableCode === 21);
  if (c === undefined) throw new Error('fixture lacks an orderable customer');
  customerCode = c.code;
  products = (await app.call('manager', 'GET', `/products?customerCode=${customerCode}&pageSize=10&sellable=true&priceState=priced`)).body.items;
});

afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const body = (overrides: Record<string, unknown> = {}) => ({
  clientRequestId: randomUUID(),
  customerCode,
  negotiationTypeCode: 2,
  notes: null,
  items: [{ productCode: products[0].code, quantity: '2', discountPercent: '5' }],
  ...overrides,
});
const replaceBody = (extra: Record<string, unknown>, expectedVersion: number) => {
  const { clientRequestId: _omit, ...rest } = body(extra);
  return { ...rest, expectedVersion };
};

describe('discountAboveLimitAccepted', () => {
  it('an old payload without the field creates an order with the mark false (detail and list)', async () => {
    const created = await app.call('seller1', 'POST', '/orders', body());
    expect(created.status).toBe(201);
    expect(OrderDetailSchema.parse(created.body).discountAboveLimitAccepted).toBe(false);
    const listed = await app.call('seller1', 'GET', '/orders?pageSize=100');
    const item = listed.body.items.find((o: Json) => o.id === created.body.id);
    expect(OrderListItemSchema.parse(item).discountAboveLimitAccepted).toBe(false);
  });

  it('round trip: true on create is stored and returned by GET, list and the row', async () => {
    const created = await app.call('seller1', 'POST', '/orders', body({ discountAboveLimitAccepted: true }));
    expect(created.status).toBe(201);
    expect(created.body.discountAboveLimitAccepted).toBe(true);
    const got = await app.call('seller1', 'GET', `/orders/${created.body.id}`);
    expect(got.body.discountAboveLimitAccepted).toBe(true);
    const listed = await app.call('seller1', 'GET', '/orders?pageSize=100');
    expect(listed.body.items.find((o: Json) => o.id === created.body.id).discountAboveLimitAccepted).toBe(true);
    const [row] = await app.database.handle.db.select().from(salesOrder).where(eq(salesOrder.id, created.body.id));
    expect(row?.discountAboveLimitAccepted).toBe(true);
  });

  it('replace: omitted keeps the mark, an explicit value changes it', async () => {
    const created = await app.call('seller1', 'POST', '/orders', body({ discountAboveLimitAccepted: true }));
    const kept = await app.call('seller1', 'PUT', `/orders/${created.body.id}`, replaceBody({}, created.body.version));
    expect(kept.status).toBe(200);
    expect(kept.body.discountAboveLimitAccepted).toBe(true);
    const cleared = await app.call('seller1', 'PUT', `/orders/${created.body.id}`, replaceBody({ discountAboveLimitAccepted: false }, kept.body.version));
    expect(cleared.body.discountAboveLimitAccepted).toBe(false);
    const set = await app.call('seller1', 'PUT', `/orders/${created.body.id}`, replaceBody({ discountAboveLimitAccepted: true }, cleared.body.version));
    expect(set.body.discountAboveLimitAccepted).toBe(true);
  });

  it('rejects a non-boolean value', async () => {
    const refused = await app.call('seller1', 'POST', '/orders', body({ discountAboveLimitAccepted: 'yes' }));
    expect(refused.status).toBe(400);
  });

  it('is audited on the order event (flag only) and has no effect on state, authority or submit', async () => {
    const marked = await app.call('seller1', 'POST', '/orders', body({ discountAboveLimitAccepted: true }));
    const plain = await app.call('seller1', 'POST', '/orders', body());
    expect(marked.body.status).toBe(plain.body.status);
    expect(marked.body.discountAuthority).toBe(plain.body.discountAuthority);
    expect(marked.body.estimatedTotal).toBe(plain.body.estimatedTotal);

    const events = await app.database.handle.db.select().from(auditLog).where(eq(auditLog.action, 'order.created'));
    const details = events.map((e) => e.detail as Json);
    expect(details.find((d) => d.orderId === marked.body.id).discountAboveLimitAccepted).toBe(true);
    expect(details.find((d) => d.orderId === plain.body.id).discountAboveLimitAccepted).toBeUndefined();

    // Submission is disabled in this app (SNK-6): the outcome is identical with and without the mark.
    const a = await app.call('seller1', 'POST', `/orders/${marked.body.id}/submit`);
    const b = await app.call('seller1', 'POST', `/orders/${plain.body.id}/submit`);
    expect(a.status).toBe(b.status);
    expect(a.body.status).toBe(b.body.status);
  });
});
