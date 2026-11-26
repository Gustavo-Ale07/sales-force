import { describe, expect, it } from 'vitest';
import { buildGoalsOverview, percentOf, type SalesHistoryMonthlyBucket, type SellerGoal } from '../src/index.js';

const bucket = (customerCode: number, sellerCode: number, totalAmount: string, over: Partial<SalesHistoryMonthlyBucket> = {}): SalesHistoryMonthlyBucket => ({
  customerCode,
  sellerCode,
  month: '2026-11',
  topCode: 900,
  topKind: 'sale',
  noteCount: 1,
  totalAmount,
  ...over,
});

const goal = (sellerCode: number, revenueTarget: string, quantityTarget: string, month = '2026-11'): SellerGoal => ({ sellerCode, month, revenueTarget, quantityTarget });

describe('percentOf', () => {
  it('rounds to one decimal and refuses a zero or missing base', () => {
    expect(percentOf('50', '200')).toBe('25');
    expect(percentOf('1', '3')).toBe('33.3');
    expect(percentOf('250', '200')).toBe('125');
    expect(percentOf('10', '0')).toBeNull();
    expect(percentOf('10', null)).toBeNull();
    expect(percentOf(null, '10')).toBeNull();
  });
});

describe('buildGoalsOverview: realized and goal', () => {
  const input = {
    month: '2026-11',
    sellerCodes: [1],
    goals: [goal(1, '1000.00', '40'), goal(1, '500.00', '10'), goal(1, '9999', '9', '2026-10'), goal(2, '777', '7')],
    buckets: [bucket(10, 1, '100.50'), bucket(11, 1, '300.00'), bucket(12, 1, '50', { topKind: 'return', topCode: 901 }), bucket(13, 1, '5', { topKind: 'other' })],
    portfolio: [{ customerCode: 10, sellerCode: 1 }, { customerCode: 11, sellerCode: 1 }, { customerCode: 12, sellerCode: 1 }, { customerCode: 14, sellerCode: 1 }],
  };

  it('sums the month goals of the scope sellers only', () => {
    const { total } = buildGoalsOverview(input);
    expect(total.revenue.target).toBe('1500.00');
    expect(total.quantity.target).toBe('50');
  });

  it('realized counts sale buckets only (returns and other TOPs are ignored) and gives the percentage', () => {
    const { total } = buildGoalsOverview(input);
    expect(total.revenue.realized).toBe('400.50');
    expect(total.revenue.percent).toBe('26.7');
    expect(total.quantity.realized).toBeNull();
    expect(total.quantity.percent).toBeNull();
  });

  it('a month with no goal row has a null target and null percent, never zero', () => {
    const { total } = buildGoalsOverview({ ...input, goals: [] });
    expect(total.revenue.target).toBeNull();
    expect(total.revenue.percent).toBeNull();
    expect(total.revenue.realized).toBe('400.50');
  });

  it('a zero value target (quantity only goal) is no revenue target', () => {
    const { total } = buildGoalsOverview({ ...input, goals: [goal(1, '0', '150')] });
    expect(total.revenue.target).toBeNull();
    expect(total.quantity.target).toBe('150');
  });

  it('without sales history the realized figures are null, not zero', () => {
    const { total } = buildGoalsOverview({ ...input, buckets: null });
    expect(total.revenue.realized).toBeNull();
    expect(total.positivation).toBeNull();
  });

  it('ignores goals and sales of sellers outside the scope', () => {
    const { total } = buildGoalsOverview({ ...input, buckets: [...input.buckets, bucket(99, 2, '10000')] });
    expect(total.revenue.realized).toBe('400.50');
  });
});

describe('buildGoalsOverview: positivation', () => {
  it('counts portfolio customers with at least one sale in the month', () => {
    const { total } = buildGoalsOverview({
      month: '2026-11',
      sellerCodes: [1],
      goals: [],
      buckets: [bucket(10, 1, '1'), bucket(10, 1, '2', { topCode: 901 }), bucket(11, 1, '1', { topKind: 'return' }), bucket(12, 1, '1', { noteCount: 0 }), bucket(13, 1, '1', { month: '2026-10' })],
      portfolio: [10, 11, 12, 13, 14].map((customerCode) => ({ customerCode, sellerCode: 1 })),
    });
    expect(total.positivation).toEqual({ positivated: 1, total: 5, percent: '20' });
  });

  it('a customer outside the portfolio never counts, even with a sale', () => {
    const { total } = buildGoalsOverview({
      month: '2026-11',
      sellerCodes: [1],
      goals: [],
      buckets: [bucket(77, 1, '500')],
      portfolio: [{ customerCode: 10, sellerCode: 1 }],
    });
    expect(total.positivation).toEqual({ positivated: 0, total: 1, percent: '0' });
  });

  it('a sale of a portfolio customer made under another seller counts for the portfolio owner', () => {
    const { total, bySeller } = buildGoalsOverview({
      month: '2026-11',
      sellerCodes: [1],
      goals: [],
      buckets: [bucket(10, 2, '500')],
      portfolio: [{ customerCode: 10, sellerCode: 1 }],
    });
    expect(total.positivation?.positivated).toBe(1);
    expect(bySeller.find((row) => row.sellerCode === 1)?.positivation?.positivated).toBe(1);
  });

  it('an empty portfolio has no percentage', () => {
    const { total } = buildGoalsOverview({ month: '2026-11', sellerCodes: [1], goals: [], buckets: [], portfolio: [] });
    expect(total.positivation).toEqual({ positivated: 0, total: 0, percent: null });
  });
});

describe('buildGoalsOverview: per seller rows', () => {
  it('lists every seller with a goal, a sale or a portfolio, ascending, each with its own figures', () => {
    const { bySeller } = buildGoalsOverview({
      month: '2026-11',
      sellerCodes: null,
      goals: [goal(3, '100', '1')],
      buckets: [bucket(10, 2, '40'), bucket(11, 3, '60')],
      portfolio: [{ customerCode: 10, sellerCode: 2 }, { customerCode: 11, sellerCode: 3 }, { customerCode: 12, sellerCode: 3 }],
    });
    expect(bySeller.map((row) => row.sellerCode)).toEqual([2, 3]);
    expect(bySeller[0]?.revenue).toEqual({ target: null, realized: '40.00', percent: null });
    expect(bySeller[1]?.revenue).toEqual({ target: '100.00', realized: '60.00', percent: '60' });
    expect(bySeller[1]?.positivation).toEqual({ positivated: 1, total: 2, percent: '50' });
  });

  it('sellerCodes null means every seller (manager, admin)', () => {
    const { total } = buildGoalsOverview({ month: '2026-11', sellerCodes: null, goals: [goal(5, '10', '1')], buckets: [bucket(1, 5, '5')], portfolio: [] });
    expect(total.revenue.target).toBe('10.00');
    expect(total.revenue.realized).toBe('5.00');
  });
});
