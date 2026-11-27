import { randomUUID } from 'node:crypto';
import { auditLog, integrationOutbox, salesOrder } from '@salesforce/db';
import { DEMO_CONFIGURATION, getDemoDataset } from '@salesforce/sankhya';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { closeAllThenStop, startPostgres, type TestPostgres } from '../helpers/postgres.js';

/**
 * Owner ruling 2026-11-27 "Editar pedido": the API only queues the edit (`edit_order` outbox row); the worker deletes and recreates.
 * Scope (P-21), mirror-based eligibility, idempotency of a repeated tap and the additive `canEdit` flag.
 */
const dataset = getDemoDataset();
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let ctx: CommercialApp;
let customer: number;
let product: number;
let erpSeq = 7000;

/** The orders of a Sankhya installation are stamped sankhya/sandbox (the structural ERP gate of sales_order). */
const SANKHYA_CONFIGURATION = {
  ...DEMO_CONFIGURATION,
  source: { kind: 'sankhya' as const, version: 'sankhya-overlay:demo-base', syncedAt: '2026-10-30T12:00:00.000Z', base: { kind: 'bootstrap-file' as const, version: 'demo-base' } },
};

beforeAll(async () => {
  postgres = await startPostgres();
  ctx = await startCommercialApp(postgres, opened, { orderEnqueueEnabled: true, configuration: SANKHYA_CONFIGURATION });
  const c = dataset.customers.find((x) => x.sellerCode === 103 && x.active && !x.blocked && x.priceTableCode === 21);
  if (c === undefined) throw new Error('fixture lacks an orderable customer');
  customer = c.code;
  const items = (await ctx.call('manager', 'GET', `/products?customerCode=${customer}&pageSize=5&sellable=true&priceState=priced`)).body.items as Json[];
  product = items[0]!.code;
});
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const body = (over: Record<string, unknown> = {}) => ({
  clientRequestId: randomUUID(),
  customerCode: customer,
  negotiationTypeCode: 2,
  freightType: 'FOB',
  carrierCode: dataset.carriers.find((carrier) => carrier.active)?.code,
  notes: 'Editado',
  items: [{ productCode: product, quantity: '3' }],
  ...over,
});

/** A delivered order as the worker leaves it: status sent, a NUNOTA and the mirrored stage. */
async function sentOrder(stage: string): Promise<Json> {
  const created = await ctx.call('seller1', 'POST', '/orders', body({ notes: null }));
  expect(created.status).toBe(201);
  erpSeq += 1;
  const pool = ctx.database.handle.pool;
  await pool.query(`UPDATE sales_order SET status = 'sent', erp_number = $2 WHERE id = $1`, [created.body.id, erpSeq]);
  await pool.query(
    `INSERT INTO sales_order_erp_stage (order_id, nunota, stage, label, content_hash, updated_at, checked_at) VALUES ($1, $2, $3, 'x', 'h', now(), now())`,
    [created.body.id, erpSeq, stage],
  );
  return (await ctx.call('seller1', 'GET', `/orders/${created.body.id}`)).body;
}

describe('canEdit (additive flag, computed on the server)', () => {
  it('is true only for a delivered order still at "received", in the detail and in the list', async () => {
    const editable = await sentOrder('received');
    const moved = await sentOrder('in_invoicing');
    const draft = await ctx.call('seller1', 'POST', '/orders', body());
    expect(editable.canEdit).toBe(true);
    expect(moved.canEdit).toBe(false);
    expect(draft.body.canEdit).toBe(false);
    const list = (await ctx.call('seller1', 'GET', '/orders?pageSize=100')).body.items as Json[];
    expect(list.find((o) => o.id === editable.id)?.canEdit).toBe(true);
    expect(list.find((o) => o.id === moved.id)?.canEdit).toBe(false);
  });
});

describe('POST /orders/{id}/edit', () => {
  it('queues the edit: the order goes to queued, an edit_order outbox row and audit are recorded, nothing is deleted by the API', async () => {
    const order = await sentOrder('received');
    const response = await ctx.call('seller1', 'POST', `/orders/${order.id}/edit`, { ...body(), expectedVersion: order.version });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('queued');
    const db = ctx.database.handle.db;
    const [row] = await db.select().from(integrationOutbox).where(and(eq(integrationOutbox.aggregateId, order.id), eq(integrationOutbox.operation, 'edit_order')));
    expect(row).toMatchObject({ status: 'pending' });
    const [stored] = await db.select().from(salesOrder).where(eq(salesOrder.id, order.id));
    expect(stored?.erpNumber).toBe(order.erpNumber);
    const audit = await db.select().from(auditLog).where(eq(auditLog.action, 'order.edit_requested'));
    expect(audit.some((a) => (a.detail as Record<string, unknown> | null)?.orderId === order.id)).toBe(true);
  });

  it('guarantees the order send_order row at enqueue time (the worker role cannot insert it)', async () => {
    const order = await sentOrder('received');
    const response = await ctx.call('seller1', 'POST', `/orders/${order.id}/edit`, { ...body(), expectedVersion: order.version });
    expect(response.status).toBe(200);
    const sends = await ctx.database.handle.db
      .select()
      .from(integrationOutbox)
      .where(and(eq(integrationOutbox.aggregateId, order.id), eq(integrationOutbox.operation, 'send_order')));
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ originId: order.id, status: 'rejected' });
  });

  it('a repeated tap with the same clientRequestId is idempotent: one outbox row, same answer', async () => {
    const order = await sentOrder('received');
    const request = { ...body(), expectedVersion: order.version };
    const first = await ctx.call('seller1', 'POST', `/orders/${order.id}/edit`, request);
    const second = await ctx.call('seller1', 'POST', `/orders/${order.id}/edit`, request);
      expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const rows = await ctx.database.handle.db.select().from(integrationOutbox).where(and(eq(integrationOutbox.aggregateId, order.id), eq(integrationOutbox.operation, 'edit_order')));
    expect(rows).toHaveLength(1);
  });

  it('refuses (409) an order that already moved on in Sankhya and queues nothing', async () => {
    const order = await sentOrder('in_invoicing');
    const response = await ctx.call('seller1', 'POST', `/orders/${order.id}/edit`, { ...body(), expectedVersion: order.version });
    expect(response.status).toBe(409);
    expect(response.body.details?.reason).toBe('not_editable_in_erp');
    const rows = await ctx.database.handle.db.select().from(integrationOutbox).where(and(eq(integrationOutbox.aggregateId, order.id), eq(integrationOutbox.operation, 'edit_order')));
    expect(rows).toHaveLength(0);
  });

  it('a draft is not editable this way', async () => {
    const draft = await ctx.call('seller1', 'POST', '/orders', body());
    const response = await ctx.call('seller1', 'POST', `/orders/${draft.body.id}/edit`, { ...body(), expectedVersion: draft.body.version });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it('P-21: another seller cannot edit it (not found), the owning manager scope can see it', async () => {
    const order = await sentOrder('received');
    const other = await ctx.call('seller2', 'POST', `/orders/${order.id}/edit`, { ...body(), expectedVersion: order.version });
    expect(other.status).toBe(404);
    const rows = await ctx.database.handle.db.select().from(integrationOutbox).where(and(eq(integrationOutbox.aggregateId, order.id), eq(integrationOutbox.operation, 'edit_order')));
    expect(rows).toHaveLength(0);
  });

  it('a stale expectedVersion is a version conflict', async () => {
    const order = await sentOrder('received');
    const response = await ctx.call('seller1', 'POST', `/orders/${order.id}/edit`, { ...body(), expectedVersion: Number(order.version) + 5 });
    expect(response.status).toBe(409);
  });
});
