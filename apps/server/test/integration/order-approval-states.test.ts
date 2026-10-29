import { randomUUID } from 'node:crypto';
import { OrderDetailSchema } from '@salesforce/contracts';
import { auditLog, salesOrder, salesOrderApproval } from '@salesforce/db';
import type { InstallationConfiguration } from '@salesforce/domain';
import { DEMO_ACCOUNT_EMAILS, DEMO_CONFIGURATION, getDemoDataset } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { restrictedKeys, startCommercialApp, type CommercialApp, type Json, type Who } from '../helpers/commercial-app.js';
import { startPostgres, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

/**
 * ORD-1, ORD-2, DISC-5: the approval states. Submitting above the OWNER's authority waits for approval; an edit of a
 * waiting or reprovado order returns it to draft and closes the pending request; the status follows the owner's role,
 * never of who saved it; the authority is recomputed from the stored lines at submission (Q12).
 */
const dataset = getDemoDataset();
const LIMITS = { seller: '5', manager: '10', director: '20' } as const;

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let app: CommercialApp;
let customer: number;
let priced: Json[];

beforeAll(async () => {
  postgres = await startPostgres();
  const configuration: InstallationConfiguration = {
    ...DEMO_CONFIGURATION,
    sales: { ...DEMO_CONFIGURATION.sales, discountAuthority: { limits: LIMITS } },
  };
  app = await startCommercialApp(postgres, opened, { configuration });
  const c1 = dataset.customers.find((c) => c.sellerCode === 103 && c.active && !c.blocked && c.priceTableCode === 21);
  if (c1 === undefined) throw new Error('fixture lacks an orderable customer');
  customer = c1.code;
  priced = (await app.call('manager', 'GET', `/products?customerCode=${customer}&pageSize=100&sellable=true&priceState=priced`)).body.items.slice(0, 2);
});

afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const lines = (discount: string) => [{ productCode: priced[0]?.code, quantity: '1', discountPercent: discount }];

const draft = async (who: Who, discount: string): Promise<Json> => {
  const response = await app.call(who, 'POST', '/orders', {
    clientRequestId: randomUUID(),
    customerCode: customer,
    negotiationTypeCode: 2,
    notes: null,
    items: lines(discount),
  });
  expect(response.status).toBe(201);
  return response.body;
};

const replace = (who: Who, order: Json, discount: string) =>
  app.call(who, 'PUT', `/orders/${order.id}`, {
    expectedVersion: order.version,
    customerCode: customer,
    negotiationTypeCode: 2,
    notes: null,
    items: lines(discount),
  });

const approvalsOf = (orderId: string) =>
  app.database.handle.db.select().from(salesOrderApproval).where(eq(salesOrderApproval.orderId, orderId));

const setStatus = (orderId: string, status: string) =>
  app.database.handle.db.update(salesOrder).set({ status }).where(eq(salesOrder.id, orderId));

describe('submitting above the owner authority (ORD-2)', () => {
  it('moves the order to awaiting_approval with one pending request at the required level', async () => {
    const order = await draft('seller1', '8');
    expect(order.status).toBe('draft');
    expect(order.approval).toBeNull();

    const submitted = await app.call('seller1', 'POST', `/orders/${order.id}/submit`);
    expect(submitted.status).toBe(200);
    expect(OrderDetailSchema.safeParse(submitted.body).success).toBe(true);
    expect(restrictedKeys(submitted.body)).toEqual([]);
    expect(submitted.body.status).toBe('awaiting_approval');
    expect(submitted.body.discountAuthority).toBe('needs_manager');
    expect(submitted.body.version).toBe(order.version + 1);
    expect(submitted.body.approval).toMatchObject({ requestedLevel: 'manager', decision: 'pending', decidedAt: null, decidedByName: null, comment: null });

    const rows = await approvalsOf(order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ requestedLevel: 'manager', decision: 'pending', orderVersion: submitted.body.version });
    expect(rows[0]?.requestedByAccountId).toBe(app.accounts.ids[DEMO_ACCOUNT_EMAILS.seller1]);

    const audits = await app.database.handle.db.select().from(auditLog).where(eq(auditLog.action, 'order.approval_requested'));
    expect(audits.some((a) => (a.detail as Json)?.orderId === order.id && (a.detail as Json)?.requestedLevel === 'manager')).toBe(true);
  });

  it('a discount above the manager limit asks the director level', async () => {
    const order = await draft('seller1', '15');
    const submitted = await app.call('seller1', 'POST', `/orders/${order.id}/submit`);
    expect(submitted.body.status).toBe('awaiting_approval');
    expect(submitted.body.approval.requestedLevel).toBe('director');
  });

  it('submitting again is idempotent: one request, no new version', async () => {
    const order = await draft('seller1', '8');
    const first = await app.call('seller1', 'POST', `/orders/${order.id}/submit`);
    const second = await app.call('seller1', 'POST', `/orders/${order.id}/submit`);
    expect(second.status).toBe(200);
    expect(second.body.version).toBe(first.body.version);
    expect(await approvalsOf(order.id)).toHaveLength(1);
  });

  it('within authority keeps the disabled ERP path and creates no request', async () => {
    const order = await draft('seller1', '5');
    const submitted = await app.call('seller1', 'POST', `/orders/${order.id}/submit`);
    expect(submitted.status).toBe(409);
    expect(submitted.body.code).toBe('erp_submission_disabled');
    expect(await approvalsOf(order.id)).toHaveLength(0);
    expect((await app.call('seller1', 'GET', `/orders/${order.id}`)).body.status).toBe('draft');
  });

  it('above the director ceiling the draft stays saved as blocked and only the submission is refused (Q12)', async () => {
    const order = await draft('seller1', '20.01');
    expect(order.discountAuthority).toBe('blocked');
    const submitted = await app.call('seller1', 'POST', `/orders/${order.id}/submit`);
    expect(submitted.status).toBe(409);
    expect(submitted.body.code).toBe('discount_blocked');
    const after = (await app.call('seller1', 'GET', `/orders/${order.id}`)).body;
    expect(after.status).toBe('draft');
    expect(after.discountAuthority).toBe('blocked');
    expect(await approvalsOf(order.id)).toHaveLength(0);
  });

  it('recomputes from the stored lines: a tampered stored status changes nothing (Q12)', async () => {
    const order = await draft('seller1', '8');
    await app.database.handle.db.update(salesOrder).set({ discountAuthority: 'within_authority' }).where(eq(salesOrder.id, order.id));
    const submitted = await app.call('seller1', 'POST', `/orders/${order.id}/submit`);
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe('awaiting_approval');
    expect(submitted.body.discountAuthority).toBe('needs_manager');

    const overCeiling = await draft('seller1', '8');
    await app.database.handle.db.update(salesOrder).set({ discountAuthority: 'within_authority' }).where(eq(salesOrder.id, overCeiling.id));
    await app.database.handle.db.execute(
      // lines are stored as written; push one past the ceiling directly
      (await import('drizzle-orm')).sql`update sales_order_item set discount_percent = 25 where order_id = ${overCeiling.id}`,
    );
    const refused = await app.call('seller1', 'POST', `/orders/${overCeiling.id}/submit`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('discount_blocked');
  });

  it('a seller cannot submit another seller order (out of scope looks missing)', async () => {
    const order = await draft('seller1', '8');
    expect((await app.call('seller2', 'POST', `/orders/${order.id}/submit`)).status).toBe(404);
  });
});

describe('the edit rule (ORD-1)', () => {
  it('editing an order awaiting approval returns it to draft and closes the pending request', async () => {
    const order = await draft('seller1', '8');
    const waiting = (await app.call('seller1', 'POST', `/orders/${order.id}/submit`)).body;
    const edited = await replace('seller1', waiting, '12');
    expect(edited.status).toBe(200);
    expect(edited.body.status).toBe('draft');
    expect(edited.body.discountAuthority).toBe('needs_director');
    expect(edited.body.approval).toMatchObject({ decision: 'invalidated', decidedByName: null });

    const rows = await approvalsOf(order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.decision).toBe('invalidated');
    expect(rows[0]?.decidedAt).not.toBeNull();
    expect(rows[0]?.decidedByAccountId).toBeNull();
    const audits = await app.database.handle.db.select().from(auditLog).where(eq(auditLog.action, 'order.approval_invalidated'));
    expect(audits.some((a) => (a.detail as Json)?.orderId === order.id && (a.detail as Json)?.reason === 'edited')).toBe(true);

    // A fresh submission after the edit is a new request, never the old one.
    const again = await app.call('seller1', 'POST', `/orders/${order.id}/submit`);
    expect(again.body.status).toBe('awaiting_approval');
    expect(again.body.approval.requestedLevel).toBe('director');
    expect((await approvalsOf(order.id)).filter((r) => r.decision === 'pending')).toHaveLength(1);
  });

  it('a rejected-by-approver order is editable and the edit returns it to draft; it cannot be resubmitted as it stands', async () => {
    const order = await draft('seller1', '8');
    await setStatus(order.id, 'approval_rejected');
    const current = (await app.call('seller1', 'GET', `/orders/${order.id}`)).body;
    expect(current.status).toBe('approval_rejected');

    const submitted = await app.call('seller1', 'POST', `/orders/${order.id}/submit`);
    expect(submitted.status).toBe(409);
    expect(submitted.body.code).toBe('conflict');

    const edited = await replace('seller1', current, '4');
    expect(edited.status).toBe(200);
    expect(edited.body.status).toBe('draft');
    expect(edited.body.discountAuthority).toBe('within_authority');
  });

  it('an approved order is not editable', async () => {
    const order = await draft('seller1', '8');
    await setStatus(order.id, 'approved');
    const current = (await app.call('seller1', 'GET', `/orders/${order.id}`)).body;
    const edited = await replace('seller1', current, '1');
    expect(edited.status).toBe(409);
    expect(edited.body.code).toBe('order_not_editable');
  });

  it('discarding an order awaiting approval cancels it and closes the request', async () => {
    const order = await draft('seller1', '8');
    await app.call('seller1', 'POST', `/orders/${order.id}/submit`);
    const discarded = await app.call('seller1', 'DELETE', `/orders/${order.id}`);
    expect(discarded.status).toBe(200);
    expect(discarded.body.status).toBe('cancelled');
    expect((await approvalsOf(order.id))[0]?.decision).toBe('invalidated');
  });
});

describe('the status follows the draft owner, not who saved it (DISC-5)', () => {
  it('a manager saving a seller draft does not widen its authority', async () => {
    const order = await draft('seller1', '8');
    expect(order.discountAuthority).toBe('needs_manager');
    const saved = await replace('manager', order, '8');
    expect(saved.status).toBe(200);
    expect(saved.body.discountAuthority).toBe('needs_manager');
    // The same lines in a draft the manager owns are within the manager's own authority.
    const own = await draft('manager', '8');
    expect(own.discountAuthority).toBe('within_authority');
  });

  it('the owner role also decides at submission, whoever presses the button', async () => {
    const order = await draft('seller1', '8');
    const submitted = await app.call('manager', 'POST', `/orders/${order.id}/submit`);
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe('awaiting_approval');
  });
});
