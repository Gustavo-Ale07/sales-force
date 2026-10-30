import { randomUUID } from 'node:crypto';
import { auditLog, integrationOutbox, salesOrder } from '@salesforce/db';
import { getDemoDataset } from '@salesforce/sankhya';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp, type Json, type Who } from '../helpers/commercial-app.js';
import { closeAllThenStop, startPostgres, type TestPostgres } from '../helpers/postgres.js';

const dataset = getDemoDataset();
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let on: CommercialApp;
let off: CommercialApp;
let customer: number;
let priced: Json[];
let unpriced: Json;

async function fixtures(ctx: CommercialApp): Promise<void> {
  const own = dataset.customers.find((c) => c.sellerCode === 103 && c.active && !c.blocked && c.priceTableCode === 21);
  if (own === undefined) throw new Error('fixture lacks an orderable customer');
  customer = own.code;
  const list = async (query: string): Promise<Json[]> =>
    (await ctx.call('manager', 'GET', `/products?customerCode=${customer}&pageSize=100&${query}`)).body.items;
  priced = (await list('sellable=true&priceState=priced')).slice(0, 3);
  unpriced = (await list('sellable=true&priceState=none'))[0];
}

beforeAll(async () => {
  postgres = await startPostgres();
  on = await startCommercialApp(postgres, opened, { orderEnqueueEnabled: true });
  off = await startCommercialApp(postgres, opened);
  await fixtures(on);
});
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const body = (items?: unknown[], over: Record<string, unknown> = {}) => ({
  clientRequestId: randomUUID(),
  customerCode: customer,
  negotiationTypeCode: 2,
  notes: 'teste',
  items: items ?? [{ productCode: priced[0]?.code, quantity: '2' }],
  ...over,
});

/** The demo mirror is a fake dataset; bind the stored order the way a Sankhya sandbox installation stamps it. */
async function bindTo(ctx: CommercialApp, id: string, environment: string): Promise<void> {
  // Test fixture only: the stamp is immutable by design (a trigger), so the trigger is lifted inside one transaction.
  await ctx.database.handle.db.transaction(async (tx) => {
    await tx.execute(sql`alter table sales_order disable trigger sales_order_binding_immutable_trg`);
    await tx.update(salesOrder).set({ datasetOrigin: 'sankhya', erpEnvironment: environment }).where(eq(salesOrder.id, id));
    await tx.execute(sql`alter table sales_order enable trigger sales_order_binding_immutable_trg`);
  });
}
const bindToSandbox = (ctx: CommercialApp, id: string) => bindTo(ctx, id, 'sandbox');

async function draft(ctx: CommercialApp, who: Who = 'seller1', payload: unknown = body()): Promise<string> {
  const created = await ctx.call(who, 'POST', '/orders', payload);
  expect(created.status).toBe(201);
  return created.body.id;
}

const outboxOf = (ctx: CommercialApp, id: string) =>
  ctx.database.handle.db.select().from(integrationOutbox).where(eq(integrationOutbox.aggregateId, id));

describe('API-side enqueue for the ERP (SNK-7 D-5, D-M)', () => {
  it('with the switch off (as shipped) submit stays erp_submission_disabled and writes no outbox row', async () => {
    const id = await draft(off);
    await bindToSandbox(off, id);
    const response = await off.call('seller1', 'POST', `/orders/${id}/submit`);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('erp_submission_disabled');
    expect(await outboxOf(off, id)).toHaveLength(0);
  });

  it('queues an eligible order with its outbox row (origin id = order id) and replays idempotently', async () => {
    const id = await draft(on);
    await bindToSandbox(on, id);
    const first = await on.call('seller1', 'POST', `/orders/${id}/submit`);
    expect(first.body.status).toBe('queued');
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('queued');
    const rows = await outboxOf(on, id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('pending');
    expect(rows[0]?.originId).toBe(id);
    expect(rows[0]?.operation).toBe('send_order');
    const [order] = await on.database.handle.db.select().from(salesOrder).where(eq(salesOrder.id, id));
    expect(order?.externalOriginId).toBe(id);

    const replay = await on.call('seller1', 'POST', `/orders/${id}/submit`);
    expect(replay.status).toBe(200);
    expect(replay.body.status).toBe('queued');
    expect(await outboxOf(on, id)).toHaveLength(1);
    const audits = (await on.database.handle.db.select().from(auditLog)).filter((a) => a.action === 'order.erp_enqueued');
    expect(audits.some((a) => (a.detail as Json).orderId === id)).toBe(true);
  });

  it('refuses an order that is not bound to the ERP environment (fake dataset), without queuing', async () => {
    const id = await draft(on);
    const response = await on.call('seller1', 'POST', `/orders/${id}/submit`);
    expect(response.status).toBe(409);
    expect(await outboxOf(on, id)).toHaveLength(0);
    const order = await on.call('seller1', 'GET', `/orders/${id}`);
    expect(order.body.status).toBe('draft');
  });

  it('refuses a bound order of another environment', async () => {
    const id = await draft(on);
    await bindTo(on, id, 'production');
    const response = await on.call('seller1', 'POST', `/orders/${id}/submit`);
    expect(response.status).toBe(409);
    expect(await outboxOf(on, id)).toHaveLength(0);
  });

  it('refuses an order without a negotiation type (price and discount ranges are database checks, structural rules are domain-tested)', async () => {
    expect(unpriced).toBeDefined();
    const id = await draft(on);
    await bindToSandbox(on, id);
    await on.database.handle.db.execute(sql`update sales_order set negotiation_type_code = null where id = ${id}`);
    const missing = await on.call('seller1', 'POST', `/orders/${id}/submit`);
    expect(missing.status).toBe(400);
    expect(JSON.stringify(missing.body)).toContain('missing_negotiation_type');
    expect(await outboxOf(on, id)).toHaveLength(0);
  });

  it('a queued order still pending is cancelled by the user: order cancelled, delivery withdrawn (D-5)', async () => {
    const id = await draft(on);
    await bindToSandbox(on, id);
    expect((await on.call('seller1', 'POST', `/orders/${id}/submit`)).status).toBe(200);
    const discarded = await on.call('seller1', 'DELETE', `/orders/${id}`);
    expect(discarded.status).toBe(200);
    expect(discarded.body.status).toBe('cancelled');
    const [row] = await outboxOf(on, id);
    expect(row?.status).toBe('rejected');
    expect(row?.lastErrorClass).toBe('cancelled_by_user');
  });

  it.each(['processing', 'unknown'] as const)('a queued order whose delivery is %s cannot be cancelled (409)', async (state) => {
    const id = await draft(on);
    await bindToSandbox(on, id);
    expect((await on.call('seller1', 'POST', `/orders/${id}/submit`)).status).toBe(200);
    await on.database.handle.db.update(integrationOutbox).set({ status: state }).where(eq(integrationOutbox.aggregateId, id));
    const response = await on.call('seller1', 'DELETE', `/orders/${id}`);
    expect(response.status).toBe(409);
    expect(JSON.stringify(response.body)).toContain('delivery_in_progress');
    const order = await on.call('seller1', 'GET', `/orders/${id}`);
    expect(order.body.status).toBe('queued');
  });
});
