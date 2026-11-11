import { erpCustomer, erpSalesHistoryCustomerProduct, erpSalesHistoryMonthly } from '@salesforce/db';
import { resolveCustomerScopeOutcome } from '@salesforce/domain';
import { DEMO_CONFIGURATION } from '@salesforce/sankhya';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../src/http/app-error.js';
import type { CurrentUser } from '../../src/iam/current-user.js';
import type { PolicyService } from '../../src/iam/policy.service.js';
import { toScopeActor } from '../../src/iam/policy.js';
import { MirrorRepository } from '../../src/mirror/mirror.repository.js';
import { SalesHistoryRepository } from '../../src/sales-history/sales-history.repository.js';
import { SalesHistoryService } from '../../src/sales-history/sales-history.service.js';
import { closeAllThenStop, createMigratedDatabase, startPostgres, type MigratedDatabase, type TestPostgres } from '../helpers/postgres.js';

/**
 * Authorization matrix of the sales-history read side against real PostgreSQL (P-21). The policy is
 * the real domain scope rule (`resolveCustomerScopeOutcome`) wired like `PolicyService.accessContext`:
 * a seller without a link is refused with `no_seller_scope`.
 */

let postgres: TestPostgres;
let database: MigratedDatabase;
let service: SalesHistoryService;

const SYNCED_AT = new Date('2026-11-01T03:15:00.000Z');
const base = { contentHash: 'h', syncedAt: SYNCED_AT };

const policy = {
  async accessContext(user: CurrentUser) {
    const outcome = resolveCustomerScopeOutcome(toScopeActor(user), DEMO_CONFIGURATION);
    if (!outcome.ok) throw new AppError(outcome.reason === 'no_seller_scope' ? 'no_seller_scope' : 'forbidden');
    return { configuration: DEMO_CONFIGURATION, configVersionId: 'v', scope: outcome.scope };
  },
} as unknown as PolicyService;

function user(role: CurrentUser['role'], sellerCodes: number[]): CurrentUser {
  return {
    accountId: `acc-${role}`,
    username: `${role}@example.test`,
    displayName: role,
    role,
    sellerCodes,
    sessionId: 's',
    sessionExpiresAt: new Date('2027-01-01T00:00:00Z'),
    channel: 'web',
  };
}

const PERIOD = { fromMonth: '2026-09', toMonth: '2026-10' };
const SALE = 7101;
const RETURN = 7201;

beforeAll(async () => {
  postgres = await startPostgres();
  database = await createMigratedDatabase(postgres);
  const { db } = database.handle;
  // Customers 1 and 2 belong to seller 10, customer 3 to seller 20.
  await db.insert(erpCustomer).values(
    [
      { code: 1, name: 'Cliente Um', sellerCode: 10 },
      { code: 2, name: 'Cliente Dois', sellerCode: 10 },
      { code: 3, name: 'Cliente Tres', sellerCode: 20 },
    ].map((c) => ({ ...c, active: true, isCustomer: true, ...base })),
  );
  const monthly = (customerCode: number, sellerCode: number, month: string, topCode: number, topKind: 'sale' | 'return', totalAmount: string) => ({
    customerCode,
    sellerCode,
    month,
    topCode,
    topKind,
    noteCount: 1,
    totalAmount,
    syncedAt: SYNCED_AT,
  });
  await db.insert(erpSalesHistoryMonthly).values([
    monthly(1, 10, '2026-09-01', SALE, 'sale', '1000.00'),
    monthly(1, 10, '2026-09-01', RETURN, 'return', '100.50'),
    monthly(2, 10, '2026-10-01', SALE, 'sale', '250.25'),
    monthly(3, 20, '2026-10-01', SALE, 'sale', '900.00'),
    monthly(3, 20, '2026-08-01', SALE, 'sale', '5000.00'), // outside the period
  ]);
  const product = (customerCode: number, productCode: number, topCode: number, topKind: 'sale' | 'return', quantity: string, netAmount: string) => ({
    customerCode,
    productCode,
    topCode,
    topKind,
    noteCount: 1,
    quantity,
    netAmount,
    lastSaleDate: '2026-10-15',
    syncedAt: SYNCED_AT,
  });
  await db.insert(erpSalesHistoryCustomerProduct).values([
    product(1, 500, SALE, 'sale', '10', '800.00'),
    product(1, 500, RETURN, 'return', '1', '80.00'),
    product(3, 501, SALE, 'sale', '5', '900.00'),
  ]);
  service = new SalesHistoryService(policy, new MirrorRepository(database.handle.db), new SalesHistoryRepository(database.handle.db));
});

afterAll(async () => {
  await closeAllThenStop([() => database.handle.close()], postgres);
});

describe('sales-history read service: authorization', () => {
  it('admin and manager see every seller, in decimal strings', async () => {
    for (const role of ['admin', 'manager'] as const) {
      const summary = await service.sellerMonthSummary(user(role, []), PERIOD);
      expect(summary.rows.map((r) => [r.sellerCode, r.month, r.sales, r.returns, r.net])).toEqual([
        [10, '2026-09', '1000.00', '100.50', '899.50'],
        [10, '2026-10', '250.25', '0.00', '250.25'],
        [20, '2026-10', '900.00', '0.00', '900.00'],
      ]);
      expect(summary.syncedAt).toBe(SYNCED_AT.toISOString());
    }
  });

  it('a seller sees only the notes of the linked sellers', async () => {
    const summary = await service.sellerMonthSummary(user('seller', [10]), PERIOD);
    expect(new Set(summary.rows.map((r) => r.sellerCode))).toEqual(new Set([10]));
    const ranking = await service.customerRanking(user('seller', [20]), PERIOD);
    expect(ranking.rows.map((r) => r.customerCode)).toEqual([3]);
    expect((await service.positivation(user('seller', [10]), PERIOD)).positivatedCustomers).toBe(2);
  });

  it('a seller cannot widen the scope with the seller filter', async () => {
    const summary = await service.sellerMonthSummary(user('seller', [10]), { ...PERIOD, sellerCode: 20 });
    expect(summary.rows).toEqual([]);
  });

  it('a manager may narrow to one seller', async () => {
    const summary = await service.sellerMonthSummary(user('manager', []), { ...PERIOD, sellerCode: 20 });
    expect(summary.rows.map((r) => r.sellerCode)).toEqual([20]);
  });

  it('a seller without a seller link is refused on every read (no_seller_scope)', async () => {
    const unlinked = user('seller', []);
    for (const call of [
      () => service.sellerMonthSummary(unlinked, PERIOD),
      () => service.positivation(unlinked, PERIOD),
      () => service.customerRanking(unlinked, PERIOD),
      () => service.customerProductHistory(unlinked, 1),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'no_seller_scope' });
    }
  });

  it('ranks customers by net and positivates distinct customers', async () => {
    const ranking = await service.customerRanking(user('admin', []), PERIOD);
    expect(ranking.rows.map((r) => [r.customerCode, r.net])).toEqual([
      [1, '899.50'],
      [3, '900.00'],
      [2, '250.25'],
    ].sort((a, b) => Number(b[1]) - Number(a[1])));
    expect((await service.positivation(user('admin', []), PERIOD)).positivatedCustomers).toBe(3);
  });

  it('rejects malformed, inverted and over-wide periods and bad limits', async () => {
    const admin = user('admin', []);
    await expect(service.sellerMonthSummary(admin, { fromMonth: '2026-13', toMonth: '2026-10' })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(service.sellerMonthSummary(admin, { fromMonth: '2026-10', toMonth: '2026-09' })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(service.sellerMonthSummary(admin, { fromMonth: '2020-01', toMonth: '2026-10' })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(service.customerRanking(admin, PERIOD, 0)).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('sales-history read service: customer x product history', () => {
  it('returns the history of an in-scope customer with money and quantity as strings', async () => {
    const history = await service.customerProductHistory(user('seller', [10]), 1);
    expect(history.customerCode).toBe(1);
    expect(history.products).toEqual([
      {
        productCode: 500,
        soldQuantity: '10',
        returnedQuantity: '1',
        soldAmount: '800.00',
        returnedAmount: '80.00',
        netAmount: '720.00',
        saleNoteCount: 1,
        lastSaleDate: '2026-10-15',
      },
    ]);
  });

  it('an out-of-scope customer is indistinguishable from a missing one', async () => {
    await expect(service.customerProductHistory(user('seller', [10]), 3)).rejects.toMatchObject({ code: 'not_found' });
    await expect(service.customerProductHistory(user('seller', [10]), 999)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('a manager reads any customer', async () => {
    const history = await service.customerProductHistory(user('manager', []), 3);
    expect(history.products.map((p) => p.productCode)).toEqual([501]);
  });

  it('exposes no cost or margin field', async () => {
    const history = await service.customerProductHistory(user('admin', []), 1);
    expect(JSON.stringify(history)).not.toMatch(/cost|custo|margin|margem/i);
  });
});
