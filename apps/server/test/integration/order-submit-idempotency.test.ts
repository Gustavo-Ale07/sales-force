import { randomUUID } from 'node:crypto';
import { integrationOutbox, salesOrder } from '@salesforce/db';
import { getDemoDataset } from '@salesforce/sankhya';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { closeAllThenStop, startPostgres, type TestPostgres } from '../helpers/postgres.js';

/**
 * Idempotent submit (9dd1dac, SNK-4): a second POST /orders/{id}/submit for an order the delivery already took answers 200 with its
 * CURRENT state and never creates a second integration_outbox row. Real PostgreSQL, no Sankhya contact.
 */
const dataset = getDemoDataset();
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let on: CommercialApp;
let off: CommercialApp;
let customer: number;
let productCode: number;

beforeAll(async () => {
  postgres = await startPostgres();
  on = await startCommercialApp(postgres, opened, { orderEnqueueEnabled: true });
  off = await startCommercialApp(postgres, opened);
  const own = dataset.customers.find((c) => c.sellerCode === 103 && c.active && !c.blocked && c.priceTableCode === 21);
  if (own === undefined) throw new Error('fixture lacks an orderable customer');
  customer = own.code;
  const priced: Json[] = (await on.call('manager', 'GET', `/products?customerCode=${customer}&pageSize=100&sellable=true&priceState=priced`)).body.items;
  productCode = priced[0]?.code;
});
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const body = () => ({
  clientRequestId: randomUUID(),
  customerCode: customer,
  negotiationTypeCode: 2,
  freightType: 'FOB',
  carrierCode: dataset.carriers.find((carrier) => carrier.active)?.code,
  notes: 'teste idempotencia',
  items: [{ productCode, quantity: '2' }],
});

async function draft(ctx: CommercialApp): Promise<string> {
  const created = await ctx.call('seller1', 'POST', '/orders', body());
  expect(created.status).toBe(201);
  // The demo mirror is a fake dataset; bind the stored order the way a Sankhya sandbox installation stamps it (immutable trigger lifted in one transaction).
  await ctx.database.handle.db.transaction(async (tx) => {
    await tx.execute(sql`alter table sales_order disable trigger sales_order_binding_immutable_trg`);
    await tx.update(salesOrder).set({ datasetOrigin: 'sankhya', erpEnvironment: 'sandbox' }).where(eq(salesOrder.id, created.body.id));
    await tx.execute(sql`alter table sales_order enable trigger sales_order_binding_immutable_trg`);
  });
  return created.body.id;
}
const outboxOf = (ctx: CommercialApp, id: string) => ctx.database.handle.db.select().from(integrationOutbox).where(eq(integrationOutbox.aggregateId, id));
const submit = (ctx: CommercialApp, id: string) => ctx.call('seller1', 'POST', `/orders/${id}/submit`);

describe('submit replay is idempotent (same state, exactly one outbox row)', () => {
  it('queued: the replay answers 200 queued with the same version and one row', async () => {
    const id = await draft(on);
    const first = await submit(on, id);
    expect(first.status).toBe(200);
    const again = await submit(on, id);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id, status: 'queued', version: first.body.version });
    expect(await outboxOf(on, id)).toHaveLength(1);
  });

  it.each([
    ['sent', { erpNumber: 7777 }],
    ['unknown', {}],
  ] as const)('%s: the replay answers 200 with the CURRENT state and writes no second outbox row', async (status, extra) => {
    const id = await draft(on);
    await submit(on, id);
    expect(await outboxOf(on, id)).toHaveLength(1);
    await on.database.handle.db.update(salesOrder).set({ status, ...extra }).where(eq(salesOrder.id, id));
    const replay = await submit(on, id);
    expect(replay.status).toBe(200);
    expect(replay.body.status).toBe(status);
    expect(await outboxOf(on, id)).toHaveLength(1);
    const [stored] = await on.database.handle.db.select().from(salesOrder).where(eq(salesOrder.id, id));
    expect(stored?.status).toBe(status); // the replay never moves the state
  });

  it('origin id = order id on the single outbox row', async () => {
    const id = await draft(on);
    await submit(on, id);
    const rows = await outboxOf(on, id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.originId).toBe(id);
    expect(rows[0]?.operation).toBe('send_order');
  });

  it('a concurrent double submit queues once: both answers are 200 queued, one outbox row', async () => {
    const id = await draft(on);
    const [a, b] = await Promise.all([submit(on, id), submit(on, id)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.status).toBe('queued');
    expect(b.body.status).toBe('queued');
    expect(await outboxOf(on, id)).toHaveLength(1);
  });

  it('a second order with the same content gets its own id and its own outbox row (different origin id)', async () => {
    const first = await draft(on);
    const second = await draft(on);
    await submit(on, first);
    await submit(on, second);
    expect(first).not.toBe(second);
    const [rowA] = await outboxOf(on, first);
    const [rowB] = await outboxOf(on, second);
    expect(rowA?.originId).toBe(first);
    expect(rowB?.originId).toBe(second);
    expect(rowA?.id).not.toBe(rowB?.id);
  });

  it('a seller never replays (or learns the state of) another seller order: 404/403, no outbox row', async () => {
    const id = await draft(on);
    await submit(on, id);
    const other = await on.call('seller2', 'POST', `/orders/${id}/submit`);
    expect([403, 404]).toContain(other.status);
    expect(await outboxOf(on, id)).toHaveLength(1);
  });
});

describe('what a submit still refuses', () => {
  it('erp_submission_disabled when the switch is off: 409, no state change, no outbox row, and a replay of that refusal stays a refusal', async () => {
    const id = await draft(off);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await submit(off, id);
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('erp_submission_disabled');
    }
    expect(await outboxOf(off, id)).toHaveLength(0);
    const [stored] = await off.database.handle.db.select().from(salesOrder).where(eq(salesOrder.id, id));
    expect(stored?.status).toBe('draft');
  });

  it('an approved-but-not-yet-sent order is still editable-state-guarded: PUT is order_not_editable, submit queues it once', async () => {
    const id = await draft(on);
    await on.database.handle.db.update(salesOrder).set({ status: 'approved' }).where(eq(salesOrder.id, id));
    const edit = await on.call('seller1', 'PUT', `/orders/${id}`, { expectedVersion: 1, customerCode: customer, negotiationTypeCode: 2, notes: null, items: [] });
    expect(edit.body.code).toBe('order_not_editable');
    const sent = await submit(on, id);
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe('queued');
    expect(await outboxOf(on, id)).toHaveLength(1);
  });
});
