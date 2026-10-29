import { randomUUID } from 'node:crypto';
import { DiscountLimitsResponseSchema } from '@salesforce/contracts';
import { auditLog, installationConfigurationVersion } from '@salesforce/db';
import type { InstallationConfiguration } from '@salesforce/domain';
import { DEMO_ACCOUNT_EMAILS, DEMO_CONFIGURATION, getDemoDataset } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp } from '../helpers/commercial-app.js';
import { startPostgres, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

/**
 * W-39 (DISC-3): the admin reads and replaces the three discount limits. Admin only (server-side), ascending and
 * inclusive, optimistic on the revision, a new immutable snapshot, audited, and the order routing follows it at once.
 */
const dataset = getDemoDataset();
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let app: CommercialApp;

beforeAll(async () => {
  postgres = await startPostgres();
  const configuration: InstallationConfiguration = { ...DEMO_CONFIGURATION };
  app = await startCommercialApp(postgres, opened, { configuration });
});

afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const LIMITS = { seller: '4', manager: '12.5', director: '25' };

describe('discount limits administration (W-39)', () => {
  it('only the admin reads or writes them (manager, seller: 403)', async () => {
    for (const who of ['manager', 'seller1'] as const) {
      expect((await app.call(who, 'GET', '/discount-limits')).status).toBe(403);
      const put = await app.call(who, 'PUT', '/discount-limits', { expectedRevision: 'x', limits: LIMITS });
      expect(put.status).toBe(403);
    }
  });

  it('shows the provisional 5/15/30 until the admin confirms values', async () => {
    const response = await app.call('admin', 'GET', '/discount-limits');
    expect(response.status).toBe(200);
    expect(DiscountLimitsResponseSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.limits).toEqual({ seller: '5', manager: '15', director: '30' });
    expect(response.body.provisional).toBe(true);
  });

  it('refuses malformed, descending and out-of-range limits and unknown fields (400)', async () => {
    const { body } = await app.call('admin', 'GET', '/discount-limits');
    const put = (limits: unknown, extra: Record<string, unknown> = {}) =>
      app.call('admin', 'PUT', '/discount-limits', { expectedRevision: body.revision, limits, ...extra });
    expect((await put({ seller: '10', manager: '5', director: '20' })).status).toBe(400);
    expect((await put({ seller: '5', manager: '10', director: '100' })).status).toBe(400);
    expect((await put({ seller: 'abc', manager: '10', director: '20' })).status).toBe(400);
    expect((await put({ seller: '5', manager: '10' })).status).toBe(400);
    expect((await put(LIMITS, { userOverrides: [] })).status).toBe(400);
    const unchanged = await app.call('admin', 'GET', '/discount-limits');
    expect(unchanged.body.revision).toBe(body.revision);
  });

  it('saves a new snapshot, audits it, clears the provisional flag and keeps history', async () => {
    const before = await app.call('admin', 'GET', '/discount-limits');
    const saved = await app.call('admin', 'PUT', '/discount-limits', { expectedRevision: before.body.revision, limits: LIMITS });
    expect(saved.status).toBe(200);
    expect(saved.body.limits).toEqual(LIMITS);
    expect(saved.body.provisional).toBe(false);
    expect(saved.body.revision).not.toBe(before.body.revision);

    const versions = await app.database.handle.db.select().from(installationConfigurationVersion);
    expect(versions.filter((row) => row.isCurrent)).toHaveLength(1);
    expect(versions.length).toBeGreaterThanOrEqual(2);

    const audits = await app.database.handle.db.select().from(auditLog).where(eq(auditLog.action, 'config.discount_limits_changed'));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorAccountId).toBe(app.accounts.ids[DEMO_ACCOUNT_EMAILS.admin]);
    expect(audits[0]?.detail).toMatchObject({ previousSeller: '5', previousDirector: '30', seller: '4', director: '25', wasProvisional: true });
  });

  it('a stale revision is a version_conflict and changes nothing', async () => {
    const current = await app.call('admin', 'GET', '/discount-limits');
    const stale = await app.call('admin', 'PUT', '/discount-limits', {
      expectedRevision: 'sha256:stale',
      limits: { seller: '1', manager: '2', director: '3' },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('version_conflict');
    expect((await app.call('admin', 'GET', '/discount-limits')).body.revision).toBe(current.body.revision);
  });

  it('the new limits route the very next draft (inclusive boundaries)', async () => {
    const c1 = dataset.customers.find((c) => c.sellerCode === 103 && c.active && !c.blocked && c.priceTableCode === 21);
    if (c1 === undefined) throw new Error('fixture lacks an orderable customer');
    const priced = (await app.call('manager', 'GET', `/products?customerCode=${c1.code}&pageSize=100&sellable=true&priceState=priced`)).body.items;
    const create = async (discountPercent: string) =>
      (
        await app.call('seller1', 'POST', '/orders', {
          clientRequestId: randomUUID(),
          customerCode: c1.code,
          negotiationTypeCode: 2,
          notes: null,
          items: [{ productCode: priced[0].code, quantity: '1', discountPercent }],
        })
      ).body.discountAuthority;
    expect(await create('4')).toBe('within_authority');
    expect(await create('4.01')).toBe('needs_manager');
    expect(await create('12.5')).toBe('needs_manager');
    expect(await create('12.51')).toBe('needs_director');
    expect(await create('25')).toBe('needs_director');
    expect(await create('25.01')).toBe('blocked');
  });
});
