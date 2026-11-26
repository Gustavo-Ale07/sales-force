import type { CustomerScope } from '@salesforce/domain';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/http/app-error.js';
import { GoalsService, businessMonth } from '../../src/goals/goals.service.js';
import type { GoalsRepository } from '../../src/goals/goals.repository.js';
import type { CurrentUser } from '../../src/iam/current-user.js';
import type { PolicyService } from '../../src/iam/policy.service.js';
import type { MirrorRepository } from '../../src/mirror/mirror.repository.js';
import type { SalesHistoryRepository } from '../../src/sales-history/sales-history.repository.js';

const NOW = new Date('2026-11-26T15:00:00Z');

function user(role: 'seller' | 'manager' | 'admin'): CurrentUser {
  return { accountId: 'a', role } as unknown as CurrentUser;
}

function build(scope: CustomerScope | AppError, options: { synced?: boolean } = {}) {
  const synced = options.synced ?? true;
  const seen = { goalScope: undefined as CustomerScope | undefined, portfolioScope: undefined as CustomerScope | undefined, sellersListed: 0 };
  const policy = {
    async accessContext() {
      if (scope instanceof AppError) throw scope;
      return { configuration: {}, configVersionId: 'v', scope };
    },
  } as unknown as PolicyService;
  const mirror = {
    async portfolioCustomers(s: CustomerScope) {
      seen.portfolioScope = s;
      return [
        { customerCode: 1, sellerCode: 10 },
        { customerCode: 2, sellerCode: 10 },
        { customerCode: 3, sellerCode: 20 },
      ].filter((c) => s.kind === 'all' || s.sellerCodes.includes(c.sellerCode));
    },
    async listSellers() {
      seen.sellersListed += 1;
      return [
        { code: 10, name: 'Ana', active: true },
        { code: 20, name: 'Bruno', active: true },
      ];
    },
  } as unknown as MirrorRepository;
  const goals = {
    async monthGoals(s: CustomerScope) {
      seen.goalScope = s;
      return [
        { sellerCode: 10, month: '2026-11', revenueTarget: '1000.00', quantityTarget: '50.000000' },
        { sellerCode: 20, month: '2026-11', revenueTarget: '2000.00', quantityTarget: '0.000000' },
      ].filter((g) => s.kind === 'all' || s.sellerCodes.includes(g.sellerCode));
    },
    async syncedAt() {
      return synced ? new Date('2026-11-26T10:00:00Z') : null;
    },
  } as unknown as GoalsRepository;
  const history = {
    async monthlySyncedAt() {
      return synced ? new Date('2026-11-26T03:15:00Z') : null;
    },
    async monthlyBuckets() {
      return [
        { customerCode: 1, sellerCode: 10, month: '2026-11', topCode: 1, topKind: 'sale', noteCount: 1, totalAmount: '250.00' },
        { customerCode: 3, sellerCode: 20, month: '2026-11', topCode: 1, topKind: 'sale', noteCount: 1, totalAmount: '500.00' },
        { customerCode: 2, sellerCode: 10, month: '2026-11', topCode: 9, topKind: 'return', noteCount: 1, totalAmount: '40.00' },
      ];
    },
  } as unknown as SalesHistoryRepository;
  const service = new GoalsService(policy, mirror, goals, history, () => NOW);
  return { service, seen };
}

describe('GoalsService (unit)', () => {
  it('a seller sees only the own goal, realized and positivation, with no team rows', async () => {
    const { service, seen } = build({ kind: 'sellers', sellerCodes: [10] });
    const result = await service.get(user('seller'));
    expect(seen.goalScope).toEqual({ kind: 'sellers', sellerCodes: [10] });
    expect(seen.sellersListed).toBe(0);
    expect(result.month).toBe('2026-11');
    expect(result.total.revenue).toEqual({ target: '1000.00', realized: '250.00', percent: '25' });
    expect(result.total.positivation).toEqual({ positivated: 1, total: 2, percent: '50' });
    expect(result.bySeller).toEqual([]);
  });

  it('a manager or admin sees the team inside the scope, with seller names', async () => {
    const { service } = build({ kind: 'all' });
    const result = await service.get(user('manager'));
    expect(result.total.revenue.target).toBe('3000.00');
    expect(result.total.revenue.realized).toBe('750.00');
    expect(result.total.positivation).toEqual({ positivated: 2, total: 3, percent: '66.7' });
    expect(result.bySeller.map((row) => [row.sellerCode, row.sellerName])).toEqual([
      [10, 'Ana'],
      [20, 'Bruno'],
    ]);
  });

  it('never shows cost, margin or commission fields', async () => {
    const { service } = build({ kind: 'all' });
    const json = JSON.stringify(await service.get(user('admin')));
    expect(json).not.toMatch(/cost|margin|commission|custo|margem|comiss/i);
  });

  it('without a sales-history sync the realized and positivation are unavailable, never zero', async () => {
    const { service } = build({ kind: 'all' }, { synced: false });
    const result = await service.get(user('admin'));
    expect(result.salesSyncedAt).toBeNull();
    expect(result.total.revenue.realized).toBeNull();
    expect(result.total.positivation).toBeNull();
  });

  it('a refusal from the policy (seller without link) propagates and nothing is read', async () => {
    const refusal = new AppError('no_seller_scope');
    const { service, seen } = build(refusal);
    await expect(service.get(user('seller'))).rejects.toBe(refusal);
    expect(seen.goalScope).toBeUndefined();
  });

  it('the business month follows America/Sao_Paulo', () => {
    expect(businessMonth(new Date('2026-12-01T01:00:00Z'))).toBe('2026-11');
    expect(businessMonth(new Date('2026-12-01T03:00:00Z'))).toBe('2026-12');
  });
});
