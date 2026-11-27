import { Decimal as BaseDecimal } from 'decimal.js';
import { isZeroDecimal, sumQuantities, sumTotals, type DecimalString } from './money.js';
import type { SalesHistoryMonthlyBucket } from './sales-history.js';

/**
 * Goals, realized and positivation (RF-GOL-1, RF-GOL-2). Pure functions over data mirrored from the ERP: the Force keeps nothing of its own.
 * The goal is the seller goal of the ERP goal screen (month, value, quantity). The realized value is the sum of the month's sale-TOP notes
 * (the sales-history mirror: valid-note status and sale TOPs are installation configuration, CFG-3); returns and other TOPs never count.
 * Positivation = distinct portfolio customers with at least one BILLED mobility order in the month (owner ruling 2026-11-27; mirror of
 * orders whose child sale note is billed, not cancelled). No commission, no cost or margin (P-20).
 */

export interface SellerGoal {
  readonly sellerCode: number;
  /** `YYYY-MM`. */
  readonly month: string;
  readonly revenueTarget: DecimalString;
  readonly quantityTarget: DecimalString;
  /** `general` = the seller's goal line without a product; `products` = the sum of the per-product lines. Absent = `products`. */
  readonly scope?: 'general' | 'products';
}

/**
 * The goal of one seller in one month: when a general line exists (no product) the goal is ONLY that line; otherwise it is the sum of
 * the per-product lines. The two are never added. Lines without a real seller (code below 1) are ignored.
 */
export function resolveSellerGoals(goals: readonly SellerGoal[]): SellerGoal[] {
  const keyOf = (goal: SellerGoal) => `${goal.sellerCode}|${goal.month}`;
  const hasGeneral = new Set(goals.filter((goal) => goal.scope === 'general' && goal.sellerCode >= 1).map(keyOf));
  return goals.filter((goal) => goal.sellerCode >= 1 && (hasGeneral.has(keyOf(goal)) ? goal.scope === 'general' : true));
}

export interface PortfolioCustomer {
  readonly customerCode: number;
  readonly sellerCode: number;
}

/**
 * One billed mobility order (RF-GOL-2): an order of a mobility TOP that has a billed, non-cancelled sale note child, placed in the
 * month of that billing. The ERP mirror carries only such orders; `sellerCode` 0 = the order has no seller.
 */
export interface PositivationOrder {
  readonly customerCode: number;
  readonly sellerCode: number;
  /** `YYYY-MM` of the billing. */
  readonly month: string;
  readonly orderNumber: number;
}

/** Distinct portfolio customers with at least one billed order in the month (several orders of one customer count once). */
export function positivationCount(portfolio: readonly PortfolioCustomer[], orders: readonly PositivationOrder[], month: string): number {
  const billed = new Set(orders.filter((order) => order.month === month).map((order) => order.customerCode));
  return new Set(portfolio.filter((customer) => billed.has(customer.customerCode)).map((customer) => customer.customerCode)).size;
}

export interface GoalFigure {
  /** `null` = no goal registered for the month (a zero goal is no goal). */
  readonly target: DecimalString | null;
  /** `null` = not available (never zero by default). */
  readonly realized: DecimalString | null;
  /** Realized over target, one decimal, `null` unless both exist and the target is above zero. */
  readonly percent: string | null;
}

export interface PositivationFigure {
  readonly positivated: number;
  readonly total: number;
  readonly percent: string | null;
}

export interface SellerGoalRow {
  readonly sellerCode: number;
  readonly revenue: GoalFigure;
  readonly quantity: GoalFigure;
  readonly positivation: PositivationFigure | null;
}

export interface GoalsOverview {
  readonly month: string;
  readonly total: Omit<SellerGoalRow, 'sellerCode'>;
  readonly bySeller: readonly SellerGoalRow[];
}

export interface GoalsOverviewInput {
  readonly month: string;
  /** Sellers in the caller's scope; `null` = every seller. */
  readonly sellerCodes: readonly number[] | null;
  readonly goals: readonly SellerGoal[];
  /** Sales-history buckets of the month for ANY note seller; `null` = the sales history was never mirrored. */
  readonly buckets: readonly SalesHistoryMonthlyBucket[] | null;
  /** Billed mobility orders of ANY seller; `null` = the positivation mirror was never read (no data), an empty list = zero. */
  readonly positivationOrders: readonly PositivationOrder[] | null;
  /** Portfolio customers of the scope with their owning seller. */
  readonly portfolio: readonly PortfolioCustomer[];
}

/** `part / base * 100` rounded half-up to one decimal; `null` when either is missing or the base is not above zero. */
export function percentOf(part: DecimalString | null, base: DecimalString | null): string | null {
  if (part === null || base === null || isZeroDecimal(base)) return null;
  return new BaseDecimal(part).div(base).times(100).toDecimalPlaces(1, BaseDecimal.ROUND_HALF_UP).toString();
}

function figure(target: DecimalString | null, realized: DecimalString | null): GoalFigure {
  return { target, realized, percent: percentOf(realized, target) };
}

function positivationOf(customers: readonly PortfolioCustomer[], orders: readonly PositivationOrder[] | null, month: string): PositivationFigure | null {
  if (orders === null) return null;
  const positivated = positivationCount(customers, orders, month);
  return { positivated, total: customers.length, percent: percentOf(String(positivated), String(customers.length)) };
}

function rowOf(
  goals: readonly SellerGoal[],
  sales: readonly SalesHistoryMonthlyBucket[] | null,
  customers: readonly PortfolioCustomer[],
  orders: readonly PositivationOrder[] | null,
  month: string,
): Omit<SellerGoalRow, 'sellerCode'> {
  const revenueTarget = sumTotals(goals.map((goal) => goal.revenueTarget));
  const quantityTarget = sumQuantities(goals.map((goal) => goal.quantityTarget));
  return {
    revenue: figure(isZeroDecimal(revenueTarget) ? null : revenueTarget, sales === null ? null : sumTotals(sales.map((row) => row.totalAmount))),
    // The realized quantity is not in the monthly mirror: it stays unavailable instead of an invented figure.
    quantity: figure(isZeroDecimal(quantityTarget) ? null : quantityTarget, null),
    positivation: positivationOf(customers, orders, month),
  };
}

export function buildGoalsOverview(input: GoalsOverviewInput): GoalsOverview {
  const scope = input.sellerCodes === null ? null : new Set(input.sellerCodes);
  const inScope = (sellerCode: number) => scope === null || scope.has(sellerCode);

  const goals = resolveSellerGoals(input.goals.filter((goal) => goal.month === input.month && inScope(goal.sellerCode)));
  const monthSales = input.buckets === null ? null : input.buckets.filter((row) => row.month === input.month && row.topKind === 'sale' && row.noteCount > 0);
  const sales = monthSales === null ? null : monthSales.filter((row) => inScope(row.sellerCode));
  const portfolio = input.portfolio.filter((customer) => inScope(customer.sellerCode));

  const sellerCodes = new Set<number>([...goals.map((g) => g.sellerCode), ...(sales ?? []).map((r) => r.sellerCode), ...portfolio.map((c) => c.sellerCode)]);
  const bySeller = [...sellerCodes]
    .sort((a, b) => a - b)
    .map((sellerCode): SellerGoalRow => ({
      sellerCode,
      ...rowOf(
        goals.filter((goal) => goal.sellerCode === sellerCode),
        sales === null ? null : sales.filter((row) => row.sellerCode === sellerCode),
        portfolio.filter((customer) => customer.sellerCode === sellerCode),
        input.positivationOrders,
        input.month,
      ),
    }));

  // A portfolio customer counts once an order of it was billed in the month, whichever seller placed the order.
  return { month: input.month, total: rowOf(goals, sales, portfolio, input.positivationOrders, input.month), bySeller };
}
