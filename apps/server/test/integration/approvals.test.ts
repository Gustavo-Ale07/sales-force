import { randomUUID } from 'node:crypto';
import { ApprovalQueueResponseSchema, OrderDetailSchema } from '@salesforce/contracts';
import { auditLog, salesOrder, salesOrderApproval } from '@salesforce/db';
import type { InstallationConfiguration } from '@salesforce/domain';
import { DEMO_ACCOUNT_EMAILS, DEMO_CONFIGURATION, getDemoDataset } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { restrictedKeys, startCommercialApp, type CommercialApp, type Json, type Who } from '../helpers/commercial-app.js';
import { startPostgres, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

/**
 * W-20 (DISC-3, DISC-4, DISC-6): the approval queue and the explicit, audited decision. Pool per level: the manager
 * decides the manager level, the admin decides the director level (labelled "Diretoria"), seller and technical decide
 * nothing. Reject needs a comment; a decided or invalidated request cannot be decided again.
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

const body = (discount: string, expectedVersion?: number) => ({
  ...(expectedVersion === undefined ? { clientRequestId: randomUUID() } : { expectedVersion }),
  customerCode: customer,
  negotiationTypeCode: 2,
  notes: null,
  items: [{ productCode: priced[0]?.code, quantity: '1', discountPercent: discount }],
});

/** A submitted order awaiting approval at the level the discount requires. */
const awaiting = async (discount: string): Promise<Json> => {
  const created = await app.call('seller1', 'POST', '/orders', body(discount));
  expect(created.status).toBe(201);
  const submitted = await app.call('seller1', 'POST', `/orders/${created.body.id}/submit`);
  expect(submitted.body.status).toBe('awaiting_approval');
  return submitted.body;
};

const queue = async (who: Who): Promise<Json[]> => {
  const response = await app.call(who, 'GET', '/approvals?pageSize=100');
  expect(response.status).toBe(200);
  expect(ApprovalQueueResponseSchema.safeParse(response.body).success).toBe(true);
  return response.body.items;
};

const approvalId = async (orderId: string): Promise<string> => {
  const rows = await app.database.handle.db.select().from(salesOrderApproval).where(eq(salesOrderApproval.orderId, orderId));
  const pending = rows.find((row) => row.decision === 'pending');
  if (pending === undefined) throw new Error('no pending approval');
  return pending.id;
};

const auditsOf = async (action: string, orderId: string) =>
  (await app.database.handle.db.select().from(auditLog).where(eq(auditLog.action, action))).filter((a) => (a.detail as Json)?.orderId === orderId);

describe('the approval pool per level (DISC-4)', () => {
  it('the manager sees only manager-level requests; the admin only director-level ones', async () => {
    const managerLevel = await awaiting('8');
    const directorLevel = await awaiting('15');
    const managerQueue = await queue('manager');
    expect(managerQueue.some((i) => i.orderId === managerLevel.id)).toBe(true);
    expect(managerQueue.some((i) => i.orderId === directorLevel.id)).toBe(false);
    const adminQueue = await queue('admin');
    expect(adminQueue.some((i) => i.orderId === directorLevel.id)).toBe(true);
    expect(adminQueue.some((i) => i.orderId === managerLevel.id)).toBe(false);
    const item = managerQueue.find((i) => i.orderId === managerLevel.id);
    expect(item).toMatchObject({ requestedLevel: 'manager', maxDiscountPercent: '8', itemCount: 1 });
    expect(restrictedKeys(managerQueue)).toEqual([]);
  });

  it('a level outside the caller pool is refused (403) and audited; the request stays pending', async () => {
    const managerLevel = await awaiting('8');
    const directorLevel = await awaiting('15');
    const wrongForAdmin = await app.call('admin', 'POST', `/approvals/${await approvalId(managerLevel.id)}/approve`, {});
    expect(wrongForAdmin.status).toBe(403);
    const wrongForManager = await app.call('manager', 'POST', `/approvals/${await approvalId(directorLevel.id)}/approve`, {});
    expect(wrongForManager.status).toBe(403);
    expect((await auditsOf('order.approval_denied', directorLevel.id)).length).toBe(1);
    expect((await app.call('seller1', 'GET', `/orders/${directorLevel.id}`)).body.status).toBe('awaiting_approval');
  });

  it('a seller can neither list nor decide (403)', async () => {
    const order = await awaiting('8');
    const id = await approvalId(order.id);
    expect((await app.call('seller1', 'GET', '/approvals')).status).toBe(403);
    expect((await app.call('seller1', 'POST', `/approvals/${id}/approve`, {})).status).toBe(403);
    expect((await app.call('seller1', 'POST', `/approvals/${id}/reject`, { comment: 'x' })).status).toBe(403);
  });
});

describe('deciding', () => {
  it('approve: records who, when and the optional comment, moves the order to approved and audits without free text', async () => {
    const order = await awaiting('8');
    const id = await approvalId(order.id);
    const response = await app.call('manager', 'POST', `/approvals/${id}/approve`, { comment: 'Cliente estratégico' });
    expect(response.status).toBe(200);
    expect(OrderDetailSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.status).toBe('approved');
    expect(response.body.version).toBe(order.version + 1);
    expect(response.body.approval).toMatchObject({ decision: 'approved', comment: 'Cliente estratégico' });
    expect(response.body.approval.decidedAt).not.toBeNull();
    expect(response.body.approval.decidedByName).not.toBeNull();
    const row = (await app.database.handle.db.select().from(salesOrderApproval).where(eq(salesOrderApproval.id, id)))[0];
    expect(row?.decidedByAccountId).toBe(app.accounts.ids[DEMO_ACCOUNT_EMAILS.manager]);
    const audits = await auditsOf('order.approval_approved', order.id);
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0]?.detail)).not.toContain('Cliente estratégico');
    expect(audits[0]?.detail).toMatchObject({ hasComment: true, commentLength: 19 });
    expect((await queue('manager')).some((i) => i.orderId === order.id)).toBe(false);
  });

  it('approve without a comment is allowed; the admin decides the director level', async () => {
    const order = await awaiting('15');
    const response = await app.call('admin', 'POST', `/approvals/${await approvalId(order.id)}/approve`, {});
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('approved');
    expect(response.body.approval.comment).toBeNull();
  });

  it('reject needs a comment (400), then returns the order as approval_rejected with the reason', async () => {
    const order = await awaiting('8');
    const id = await approvalId(order.id);
    expect((await app.call('manager', 'POST', `/approvals/${id}/reject`, {})).status).toBe(400);
    expect((await app.call('manager', 'POST', `/approvals/${id}/reject`, { comment: '   ' })).status).toBe(400);
    expect((await app.call('seller1', 'GET', `/orders/${order.id}`)).body.status).toBe('awaiting_approval');
    const response = await app.call('manager', 'POST', `/approvals/${id}/reject`, { comment: 'Desconto alto demais' });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('approval_rejected');
    expect(response.body.approval).toMatchObject({ decision: 'rejected', comment: 'Desconto alto demais' });
    expect((await auditsOf('order.approval_rejected', order.id)).length).toBe(1);
  });

  it('a second decision on the same request is refused (409 approval_not_pending)', async () => {
    const order = await awaiting('8');
    const id = await approvalId(order.id);
    expect((await app.call('manager', 'POST', `/approvals/${id}/approve`, {})).status).toBe(200);
    const again = await app.call('manager', 'POST', `/approvals/${id}/reject`, { comment: 'tarde' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('approval_not_pending');
  });

  it('after the seller edits the order the old request cannot be decided (409), and the order is a draft again', async () => {
    const order = await awaiting('8');
    const id = await approvalId(order.id);
    const edited = await app.call('seller1', 'PUT', `/orders/${order.id}`, body('9', order.version));
    expect(edited.status).toBe(200);
    expect(edited.body.status).toBe('draft');
    const late = await app.call('manager', 'POST', `/approvals/${id}/approve`, {});
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('approval_not_pending');
    expect((await queue('manager')).some((i) => i.orderId === order.id)).toBe(false);
  });

  it('an unknown request is 404', async () => {
    expect((await app.call('manager', 'POST', `/approvals/${randomUUID()}/approve`, {})).status).toBe(404);
  });

  it('limits lowered after the request: approving is refused when the lines are now blocked', async () => {
    const order = await awaiting('8');
    const id = await approvalId(order.id);
    await app.database.handle.db.update(salesOrder).set({ discountAuthority: 'within_authority' }).where(eq(salesOrder.id, order.id));
    const current = await app.call('admin', 'GET', '/discount-limits');
    const saved = await app.call('admin', 'PUT', '/discount-limits', { expectedRevision: current.body.revision, limits: { seller: '2', manager: '4', director: '6' } });
    expect(saved.status).toBe(200);
    const response = await app.call('manager', 'POST', `/approvals/${id}/approve`, {});
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('discount_blocked');
    expect((await app.call('seller1', 'GET', `/orders/${order.id}`)).body.status).toBe('awaiting_approval');
  });
});
