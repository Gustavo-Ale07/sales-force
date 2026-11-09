import { randomUUID } from 'node:crypto';
import { auditLog, integrationOrderDryRun, integrationOutbox, salesOrder } from '@salesforce/db';
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
  it('K8: GET /order-entry/configuration reports what the API applies (general.erpSubmissionEnabled)', async () => {
    expect((await off.call('seller1', 'GET', '/order-entry/configuration')).body.general.erpSubmissionEnabled).toBe(false);
    expect((await on.call('seller1', 'GET', '/order-entry/configuration')).body.general.erpSubmissionEnabled).toBe(true);
  });

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

  it.each(['pending', 'processing', 'unknown'] as const)('D-Y: a queued order whose delivery is %s has no delete (409)', async (state) => {
    const id = await draft(on);
    await bindToSandbox(on, id);
    expect((await on.call('seller1', 'POST', `/orders/${id}/submit`)).status).toBe(200);
    await on.database.handle.db.update(integrationOutbox).set({ status: state }).where(eq(integrationOutbox.aggregateId, id));
    const response = await on.call('seller1', 'DELETE', `/orders/${id}`);
    expect(response.status).toBe(409);
    expect(JSON.stringify(response.body)).toContain('delivery_in_progress');
    const order = await on.call('seller1', 'GET', `/orders/${id}`);
    expect(order.body.status).toBe('queued');
    expect(await outboxOf(on, id)).toHaveLength(1);
  });

  it('D-Z: a draft with a simulated delivery shows when it was simulated and the payload hash; a queued one does not', async () => {
    const id = await draft(on);
    await bindToSandbox(on, id);
    const db = on.database.handle.db;
    expect((await on.call('seller1', 'GET', `/orders/${id}`)).body.dryRun ?? null).toBeNull();
    const [outbox] = await db
      .insert(integrationOutbox)
      .values({ id: randomUUID(), aggregateType: 'sales_order', aggregateId: id, operation: 'send_order', payload: {}, status: 'dry_run', lastStep: 'dry_run' })
      .returning();
    await db.insert(integrationOrderDryRun).values({ id: randomUUID(), outboxId: outbox!.id, orderId: id, payload: {}, payloadHash: 'abc123' });
    const detail = (await on.call('seller1', 'GET', `/orders/${id}`)).body;
    expect(detail.status).toBe('draft');
    expect(detail.dryRun.payloadHash).toBe('abc123');
    expect(typeof detail.dryRun.at).toBe('string');
    // The mark is only for a draft: editing/sending is a new decision. Deleting the draft removes the terminal record too.
    expect((await on.call('seller1', 'DELETE', `/orders/${id}`)).status).toBe(204);
  });

  it('D-AA: Reenviar puts a rejected delivery back to the worker on the SAME outbox row; a dry run or an off switch is not resent', async () => {
    const id = await draft(on);
    await bindToSandbox(on, id);
    expect((await on.call('seller1', 'POST', `/orders/${id}/submit`)).status).toBe(200);
    const db = on.database.handle.db;
    const [before] = await outboxOf(on, id);
    await db.update(integrationOutbox).set({ status: 'rejected', attemptCount: 3, lastErrorClass: 'temporary', lastErrorMessage: 'x' }).where(eq(integrationOutbox.aggregateId, id));
    await db.update(salesOrder).set({ status: 'rejected' }).where(eq(salesOrder.id, id));

    const resent = await on.call('seller1', 'POST', `/orders/${id}/submit`);
    expect(resent.status).toBe(200);
    expect(resent.body.status).toBe('queued');
    const rows = await outboxOf(on, id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(before?.id);
    expect(rows[0]?.originId).toBe(id);
    expect(rows[0]?.status).toBe('pending');
    expect(rows[0]?.lastErrorClass).toBeNull();
    expect((await on.call('seller1', 'POST', `/orders/${id}/submit`)).body.status).toBe('queued'); // second click replays

    // a simulated delivery (dry_run) is not a failure: nothing to resend
    await db.update(integrationOutbox).set({ status: 'dry_run' }).where(eq(integrationOutbox.aggregateId, id));
    await db.update(salesOrder).set({ status: 'rejected' }).where(eq(salesOrder.id, id));
    expect((await on.call('seller1', 'POST', `/orders/${id}/submit`)).status).toBe(409);

    // with the switch off the resend is refused as well
    const offId = await draft(off);
    await bindToSandbox(off, offId);
    await off.database.handle.db.update(salesOrder).set({ status: 'rejected' }).where(eq(salesOrder.id, offId));
    expect((await off.call('seller1', 'POST', `/orders/${offId}/submit`)).body.code).toBe('erp_submission_disabled');
  });

  it('Verificar agora: an unknown delivery is made due on the SAME outbox row (no second row), audited with the actor, limited to once per 60 s', async () => {
    const id = await draft(on);
    await bindToSandbox(on, id);
    expect((await on.call('seller1', 'POST', `/orders/${id}/submit`)).status).toBe(200);
    const db = on.database.handle.db;
    const [before] = await outboxOf(on, id);
    const later = new Date(Date.now() + 3_600_000);
    await db.update(integrationOutbox).set({ status: 'unknown', nextAttemptAt: later }).where(eq(integrationOutbox.aggregateId, id));
    await db.update(salesOrder).set({ status: 'unknown' }).where(eq(salesOrder.id, id));

    // someone outside the order's scope neither sees nor touches it
    expect([403, 404]).toContain((await on.call('seller2', 'POST', `/orders/${id}/verify-delivery`)).status);
    expect((await outboxOf(on, id))[0]?.nextAttemptAt?.getTime()).toBe(later.getTime());

    const first = await on.call('seller1', 'POST', `/orders/${id}/verify-delivery`);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('unknown');
    const rows = await outboxOf(on, id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(before?.id);
    expect(rows[0]?.status).toBe('unknown');
    expect(rows[0]?.originId).toBe(id);
    expect(rows[0]?.nextAttemptAt!.getTime()).toBeLessThan(later.getTime());
    const audits = (await db.select().from(auditLog)).filter((a) => a.action === 'order.delivery_verify_requested' && (a.detail as Json).orderId === id);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorAccountId).toBeTruthy();

    // at most one request per minute for the order (a manager is limited too: same order)
    const again = await on.call('manager', 'POST', `/orders/${id}/verify-delivery`);
    expect(again.status).toBe(429);
    expect((await outboxOf(on, id))).toHaveLength(1);

    // after the interval a manager (and admin) may ask again
    await db.execute(sql`update integration_outbox set payload = payload || '{"lastVerifyRequestedAt":"2000-01-01T00:00:00.000Z"}'::jsonb where aggregate_id = ${id}`);
    expect((await on.call('manager', 'POST', `/orders/${id}/verify-delivery`)).status).toBe(200);
    await db.execute(sql`update integration_outbox set payload = payload || '{"lastVerifyRequestedAt":"2000-01-01T00:00:00.000Z"}'::jsonb where aggregate_id = ${id}`);
    expect((await on.call('admin', 'POST', `/orders/${id}/verify-delivery`)).status).toBe(200);

    // once the delivery is resolved the call changes nothing
    await db.update(salesOrder).set({ status: 'sent' }).where(eq(salesOrder.id, id));
    const done = await on.call('seller1', 'POST', `/orders/${id}/verify-delivery`);
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('sent');
    expect(await outboxOf(on, id)).toHaveLength(1);
  });

  it('D-Y: a rejected order (delivery finished, no ERP number) is deleted together with its delivery record', async () => {
    const id = await draft(on);
    await bindToSandbox(on, id);
    expect((await on.call('seller1', 'POST', `/orders/${id}/submit`)).status).toBe(200);
    const db = on.database.handle.db;
    await db.update(integrationOutbox).set({ status: 'rejected', lastErrorClass: 'validation' }).where(eq(integrationOutbox.aggregateId, id));
    await db.update(salesOrder).set({ status: 'rejected' }).where(eq(salesOrder.id, id));
    expect((await on.call('seller1', 'DELETE', `/orders/${id}`)).status).toBe(204);
    expect(await outboxOf(on, id)).toHaveLength(0);
    expect((await on.call('seller1', 'GET', `/orders/${id}`)).status).toBe(404);
  });
});
