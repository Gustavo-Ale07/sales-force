import { Decimal as BaseDecimal } from 'decimal.js';
import { isZeroDecimal, sumQuantities, sumTotals, type DecimalString } from './money.js';
import type { SalesHistoryMonthlyBucket } from './sales-history.js';

/**
 * Goals, realized and positivation (RF-GOL-1, RF-GOL-2). Pure functions over data mirrored from the ERP: the Force keeps nothing of its own.
 * The goal is the seller goal of the ERP goal screen (month, value, quantity). The realized value is the sum of the month's sale-TOP notes
 * (the sales-history mirror: valid-note status and sale TOPs are installation configuration, CFG-3); returns and other TOPs never count.
 * Positivation = portfolio customers with at least one sale note in the month. No commission, no cost or margin (P-20).
 */

export interface SellerGoal {
  readonly sellerCode: number;
  /** `YYYY-MM`. */
  readonly month: string;
  readonly revenueTarget: DecimalString;
  readonly quantityTarget: DecimalString;
}

export interface PortfolioCustomer {
  readonly customerCode: number;
  readonly sellerCode: number;
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

function positivationOf(customers: readonly PortfolioCustomer[], positivatedCodes: ReadonlySet<number> | null): PositivationFigure | null {
  if (positivatedCodes === null) return null;
  const positivated = customers.filter((customer) => positivatedCodes.has(customer.customerCode)).length;
  return { positivated, total: customers.length, percent: percentOf(String(positivated), String(customers.length)) };
}

function rowOf(
  goals: readonly SellerGoal[],
  sales: readonly SalesHistoryMonthlyBucket[] | null,
  customers: readonly PortfolioCustomer[],
  positivatedCodes: ReadonlySet<number> | null,
): Omit<SellerGoalRow, 'sellerCode'> {
  const revenueTarget = sumTotals(goals.map((goal) => goal.revenueTarget));
  const quantityTarget = sumQuantities(goals.map((goal) => goal.quantityTarget));
  return {
    revenue: figure(isZeroDecimal(revenueTarget) ? null : revenueTarget, sales === null ? null : sumTotals(sales.map((row) => row.totalAmount))),
    // The realized quantity is not in the monthly mirror: it stays unavailable instead of an invented figure.
    quantity: figure(isZeroDecimal(quantityTarget) ? null : quantityTarget, null),
    positivation: positivationOf(customers, positivatedCodes),
  };
}

export function buildGoalsOverview(input: GoalsOverviewInput): GoalsOverview {
  const scope = input.sellerCodes === null ? null : new Set(input.sellerCodes);
  const inScope = (sellerCode: number) => scope === null || scope.has(sellerCode);

  const goals = input.goals.filter((goal) => goal.month === input.month && inScope(goal.sellerCode));
  const monthSales = input.buckets === null ? null : input.buckets.filter((row) => row.month === input.month && row.topKind === 'sale' && row.noteCount > 0);
  const sales = monthSales === null ? null : monthSales.filter((row) => inScope(row.sellerCode));
  const portfolio = input.portfolio.filter((customer) => inScope(customer.sellerCode));
  // A portfolio customer counts once it bought in the month, whichever seller issued the note.
  const positivatedCodes = monthSales === null ? null : new Set(monthSales.map((row) => row.customerCode));

  const sellerCodes = new Set<number>([...goals.map((g) => g.sellerCode), ...(sales ?? []).map((r) => r.sellerCode), ...portfolio.map((c) => c.sellerCode)]);
  const bySeller = [...sellerCodes]
    .sort((a, b) => a - b)
    .map((sellerCode): SellerGoalRow => ({
      sellerCode,
      ...rowOf(
        goals.filter((goal) => goal.sellerCode === sellerCode),
        sales === null ? null : sales.filter((row) => row.sellerCode === sellerCode),
        portfolio.filter((customer) => customer.sellerCode === sellerCode),
        positivatedCodes,
      ),
    }));

  return { month: input.month, total: rowOf(goals, sales, portfolio, positivatedCodes), bySeller };
}
