import { randomUUID } from 'node:crypto';
import { ConfigurationSummarySchema, OrderEntryConfigurationSchema } from '@salesforce/contracts';
import { auditLog, salesOrderApproval } from '@salesforce/db';
import type { InstallationConfiguration } from '@salesforce/domain';
import { DEMO_CONFIGURATION, getDemoDataset } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { startPostgres, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

/**
 * D-M (resolves R26 for the pilot): in `erp` mode (the default) discount and credit release belong to Sankhya.
 * Force has no approval state, no discount block, no approval queue and no limits screen; the order goes to the
 * submission queue as today. `force` mode keeps the reviewed flow (covered by its own suites).
 */
const dataset = getDemoDataset();
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let erp: CommercialApp;
let force: CommercialApp;
let customerCode: number;
let productCode: number;

const withAuthority = (discountAuthority: InstallationConfiguration['sales']['discountAuthority']): InstallationConfiguration => ({
  ...DEMO_CONFIGURATION,
  sales: { ...DEMO_CONFIGURATION.sales, ...(discountAuthority === undefined ? {} : { discountAuthority }) },
});

beforeAll(async () => {
  postgres = await startPostgres();
  // erp: no stored block at all (the default) -- and a stored block with limits but no mode must also mean erp.
  erp = await startCommercialApp(postgres, opened, {
    configuration: withAuthority({ limits: { seller: '5', manager: '15', director: '30' } }),
  });
  force = await startCommercialApp(postgres, opened, {
    configuration: withAuthority({ mode: 'force', limits: { seller: '5', manager: '15', director: '30' } }),
  });
  const c = dataset.customers.find((x) => x.sellerCode === 103 && x.active && !x.blocked && x.priceTableCode === 21);
  if (c === undefined) throw new Error('fixture lacks an orderable customer');
  customerCode = c.code;
  const products = (await erp.call('manager', 'GET', `/products?customerCode=${customerCode}&pageSize=10&sellable=true&priceState=priced`)).body.items;
  productCode = products[0].code;
});

afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const create = (app: CommercialApp, discountPercent: string) =>
  app.call('seller1', 'POST', '/orders', {
    clientRequestId: randomUUID(),
    customerCode,
    negotiationTypeCode: 2,
    notes: null,
    items: [{ productCode, quantity: '1', discountPercent }],
  });

describe('discount authority mode erp (D-M)', () => {
  it('a 50% discount order is accepted and reaches the submission queue without any approval state', async () => {
    const created = await create(erp, '50');
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('draft');
    expect(created.body.discountAuthority).toBe('within_authority');

    const submitted = await erp.call('seller1', 'POST', `/orders/${created.body.id}/submit`);
    // Same as every order within authority today: the Sankhya submission is not enabled yet (SNK-4/SNK-6), nothing waits for approval.
    expect(submitted.status).toBe(409);
    expect(submitted.body.code).toBe('erp_submission_disabled');
    expect(submitted.body.code).not.toBe('discount_blocked');

    const detail = await erp.call('seller1', 'GET', `/orders/${created.body.id}`);
    expect(detail.body.status).toBe('draft');
    expect(detail.body.approval).toBeNull();
    const rows = await erp.database.handle.db.select().from(salesOrderApproval).where(eq(salesOrderApproval.orderId, created.body.id));
    expect(rows).toHaveLength(0);
    const audits = await erp.database.handle.db.select().from(auditLog).where(eq(auditLog.action, 'order.approval_requested'));
    expect(audits.some((a) => (a.detail as Json)?.orderId === created.body.id)).toBe(false);
  });

  it('structural validity still applies: 100% and negative are refused', async () => {
    expect((await create(erp, '100')).status).toBe(400);
    expect((await create(erp, '-1')).status).toBe(400);
    expect((await create(erp, '99.99')).status).toBe(201);
  });

  it('the approval queue and the limits screen are disabled (not found), even for the admin', async () => {
    expect((await erp.call('admin', 'GET', '/approvals')).status).toBe(404);
    expect((await erp.call('manager', 'GET', '/approvals')).status).toBe(404);
    expect((await erp.call('admin', 'POST', `/approvals/${randomUUID()}/approve`, {})).status).toBe(404);
    expect((await erp.call('admin', 'GET', '/discount-limits')).status).toBe(404);
  });

  it('exposes the mode to clients so web and mobile hide W-39, W-20 and M-14', async () => {
    const entry = await erp.call('seller1', 'GET', '/order-entry/configuration');
    expect(OrderEntryConfigurationSchema.safeParse(entry.body).success).toBe(true);
    expect(entry.body.sales.discountAuthorityMode).toBe('erp');
    const summary = await erp.call('admin', 'GET', '/configuration');
    expect(ConfigurationSummarySchema.safeParse(summary.body.configuration).success).toBe(true);
    expect(summary.body.configuration.sales.discountAuthorityMode).toBe('erp');
  });
});

describe('discount authority mode force (D-M) keeps the reviewed flow', () => {
  it('the same 50% order is blocked above the ceiling and the screens exist', async () => {
    const created = await create(force, '50');
    expect(created.status).toBe(201);
    expect(created.body.discountAuthority).toBe('blocked');
    expect((await force.call('admin', 'GET', '/discount-limits')).status).toBe(200);
    expect((await force.call('admin', 'GET', '/approvals')).status).toBe(200);
    expect((await force.call('seller1', 'GET', '/order-entry/configuration')).body.sales.discountAuthorityMode).toBe('force');
  });
});
