import type { CustomerScope } from '@salesforce/domain';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/http/app-error.js';
import type { CurrentUser } from '../../src/iam/current-user.js';
import type { PolicyService } from '../../src/iam/policy.service.js';
import type { MirrorRepository } from '../../src/mirror/mirror.repository.js';
import type { SalesHistoryMonthlyFilter, SalesHistoryRepository } from '../../src/sales-history/sales-history.repository.js';
import { SalesHistoryService } from '../../src/sales-history/sales-history.service.js';

const USER = { accountId: 'a' } as CurrentUser;

function build(scope: CustomerScope | AppError, customers: number[] = []) {
  const seen: SalesHistoryMonthlyFilter[] = [];
  const policy = {
    async accessContext() {
      if (scope instanceof AppError) throw scope;
      return { configuration: {}, configVersionId: 'v', scope };
    },
  } as unknown as PolicyService;
  const mirror = {
    async findCustomer(_scope: CustomerScope, code: number) {
      return customers.includes(code) ? { code } : null;
    },
  } as unknown as MirrorRepository;
  const history = {
    async monthlyBuckets(filter: SalesHistoryMonthlyFilter) {
      seen.push(filter);
      return [
        { customerCode: 1, sellerCode: 10, month: '2026-09', topCode: 1, topKind: 'sale', noteCount: 2, totalAmount: '10.10' },
        { customerCode: 1, sellerCode: 10, month: '2026-09', topCode: 2, topKind: 'return', noteCount: 1, totalAmount: '0.15' },
      ] as const;
    },
    async customerProducts() {
      return [];
    },
    async monthlySyncedAt() {
      return null;
    },
  } as unknown as SalesHistoryRepository;
  return { service: new SalesHistoryService(policy, mirror, history), seen };
}

const PERIOD = { fromMonth: '2026-09', toMonth: '2026-10' };

describe('SalesHistoryService (unit)', () => {
  it('passes the policy scope to the repository, never one of its own', async () => {
    const scope: CustomerScope = { kind: 'sellers', sellerCodes: [10] };
    const { service, seen } = build(scope);
    await service.sellerMonthSummary(USER, { ...PERIOD, sellerCode: 99 });
    expect(seen[0]?.scope).toBe(scope);
    expect(seen[0]?.sellerCode).toBe(99);
  });

  it('computes money with the domain: exact decimal strings, negative nets allowed', async () => {
    const { service } = build({ kind: 'all' });
    const summary = await service.sellerMonthSummary(USER, PERIOD);
    expect(summary.rows[0]).toMatchObject({ sales: '10.10', returns: '0.15', net: '9.95' });
    expect(summary.syncedAt).toBeNull();
  });

  it('propagates a policy refusal without reading anything', async () => {
    const { service, seen } = build(new AppError('no_seller_scope'));
    await expect(service.sellerMonthSummary(USER, PERIOD)).rejects.toMatchObject({ code: 'no_seller_scope' });
    await expect(service.customerProductHistory(USER, 1)).rejects.toMatchObject({ code: 'no_seller_scope' });
    expect(seen).toHaveLength(0);
  });

  it('validates the period before touching the policy or the database', async () => {
    const { service, seen } = build({ kind: 'all' });
    for (const bad of [
      { fromMonth: '2026-9', toMonth: '2026-10' },
      { fromMonth: '2026-10', toMonth: '2026-09' },
      { fromMonth: '2020-01', toMonth: '2026-10' },
    ]) {
      await expect(service.positivation(USER, bad)).rejects.toMatchObject({ code: 'validation_failed' });
    }
    await expect(service.customerRanking(USER, PERIOD, 501)).rejects.toMatchObject({ code: 'validation_failed' });
    expect(seen).toHaveLength(0);
  });

  it('answers an out-of-scope customer exactly like a missing one', async () => {
    const { service } = build({ kind: 'sellers', sellerCodes: [10] }, [1]);
    await expect(service.customerProductHistory(USER, 2)).rejects.toMatchObject({ code: 'not_found' });
    await expect(service.customerProductHistory(USER, 1)).resolves.toMatchObject({ customerCode: 1, products: [] });
  });
});
