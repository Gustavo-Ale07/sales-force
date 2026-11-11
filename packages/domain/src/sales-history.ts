import { compareSignedDecimalStrings, subtractTotals, sumTotals, type DecimalString } from './money.js';

/**
 * Sales-history rules (stage D, block 1): pure functions over the monthly buckets mirrored from the ERP.
 *
 * Which TOP codes mean "sale" and which mean "return" is installation configuration (CFG-3); this module only receives them.
 * The rule "net = sales TOP total minus return TOP total" and "positivated = at least one sale-TOP note" is the simplest reading
 * and is TO CONFIRM with the business owner (docs/sankhya-spike.md): the TOP sets and the note status set are configurable so
 * the confirmation changes configuration, not code. All amounts are exact decimal strings (DATA-3); a net can be negative.
 */

/** Installation configuration: the TOP codes that count as a sale and as a return. */
export interface SalesHistoryTops {
  readonly saleTopCodes: readonly number[];
  readonly returnTopCodes: readonly number[];
}

export type SalesHistoryTopsProblem = 'no_sale_top' | 'invalid_top_code' | 'top_is_sale_and_return';

export type SalesHistoryTopsOutcome =
  | { readonly ok: true; readonly value: SalesHistoryTops }
  | { readonly ok: false; readonly reason: SalesHistoryTopsProblem };

/** One mirrored bucket: customer x seller x month (`YYYY-MM`) x TOP. `sellerCode` 0 = the note has no seller. */
export interface SalesHistoryMonthlyBucket {
  readonly customerCode: number;
  readonly sellerCode: number;
  readonly month: string;
  readonly topCode: number;
  /** Sale or return, decided from the configuration when the snapshot was written; `other` rows are ignored by every rule. */
  readonly topKind: SalesHistoryTopKind;
  readonly noteCount: number;
  readonly totalAmount: DecimalString;
}

export type SalesHistoryTopKind = 'sale' | 'return' | 'other';

function isTopCode(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

/** Normalizes (sorted, de-duplicated) and validates the TOP configuration: at least one sale TOP, no TOP in both sets. */
export function validateSalesHistoryTops(tops: SalesHistoryTops): SalesHistoryTopsOutcome {
  const sale = tops.saleTopCodes;
  const back = tops.returnTopCodes;
  if (!Array.isArray(sale) || !Array.isArray(back) || ![...sale, ...back].every(isTopCode)) return { ok: false, reason: 'invalid_top_code' };
  if (sale.length === 0) return { ok: false, reason: 'no_sale_top' };
  const saleSet = new Set(sale);
  if (back.some((code) => saleSet.has(code))) return { ok: false, reason: 'top_is_sale_and_return' };
  const ascending = (a: number, b: number) => a - b;
  return { ok: true, value: { saleTopCodes: [...saleSet].sort(ascending), returnTopCodes: [...new Set(back)].sort(ascending) } };
}

export function classifySalesHistoryTop(topCode: number, tops: SalesHistoryTops): SalesHistoryTopKind {
  if (tops.saleTopCodes.includes(topCode)) return 'sale';
  if (tops.returnTopCodes.includes(topCode)) return 'return';
  return 'other';
}

export interface SalesHistorySellerMonth {
  readonly sellerCode: number;
  readonly month: string;
  readonly sales: DecimalString;
  readonly returns: DecimalString;
  /** Sales minus returns; may be negative. */
  readonly net: DecimalString;
  readonly saleNoteCount: number;
  readonly returnNoteCount: number;
  /** Distinct customers with at least one sale-TOP note in this seller and month. */
  readonly positivatedCustomers: number;
}

interface Accumulator {
  readonly sales: DecimalString[];
  readonly returns: DecimalString[];
  saleNotes: number;
  returnNotes: number;
  readonly positivated: Set<number>;
}

function emptyAccumulator(): Accumulator {
  return { sales: [], returns: [], saleNotes: 0, returnNotes: 0, positivated: new Set() };
}

function addBucket(into: Accumulator, row: SalesHistoryMonthlyBucket, kind: SalesHistoryTopKind): void {
  if (kind === 'sale') {
    into.sales.push(row.totalAmount);
    into.saleNotes += row.noteCount;
    if (row.noteCount > 0) into.positivated.add(row.customerCode);
  } else if (kind === 'return') {
    into.returns.push(row.totalAmount);
    into.returnNotes += row.noteCount;
  }
}

/** Sales, returns, net and positivation per seller and month, ordered by seller then month. Buckets of other TOPs are ignored. */
export function summarizeSalesBySellerMonth(rows: readonly SalesHistoryMonthlyBucket[]): SalesHistorySellerMonth[] {
  const groups = new Map<string, { sellerCode: number; month: string; acc: Accumulator }>();
  for (const row of rows) {
    const kind = row.topKind;
    if (kind === 'other') continue;
    const key = `${row.sellerCode}|${row.month}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = { sellerCode: row.sellerCode, month: row.month, acc: emptyAccumulator() };
      groups.set(key, group);
    }
    addBucket(group.acc, row, kind);
  }
  return [...groups.values()]
    .sort((a, b) => a.sellerCode - b.sellerCode || (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
    .map(({ sellerCode, month, acc }) => {
      const sales = sumTotals(acc.sales);
      const returns = sumTotals(acc.returns);
      return {
        sellerCode,
        month,
        sales,
        returns,
        net: subtractTotals(sales, returns),
        saleNoteCount: acc.saleNotes,
        returnNoteCount: acc.returnNotes,
        positivatedCustomers: acc.positivated.size,
      };
    });
}

/** Distinct customers with at least one sale-TOP note (note count above zero) in the given rows, ascending. */
export function positivatedCustomerCodes(rows: readonly SalesHistoryMonthlyBucket[]): ReadonlySet<number> {
  const codes: number[] = [];
  for (const row of rows) {
    if (row.noteCount > 0 && row.topKind === 'sale') codes.push(row.customerCode);
  }
  return new Set(codes.sort((a, b) => a - b));
}

export interface SalesHistoryCustomerRank {
  readonly customerCode: number;
  readonly sales: DecimalString;
  readonly returns: DecimalString;
  readonly net: DecimalString;
  readonly saleNoteCount: number;
}

/**
 * Customers ranked by net (sales minus returns) over the given rows, highest first, ties by customer code. A customer that
 * only returned appears with a negative net. `limit` keeps the first N after ranking.
 */
export function rankCustomersByNet(rows: readonly SalesHistoryMonthlyBucket[], limit?: number): SalesHistoryCustomerRank[] {
  const byCustomer = new Map<number, Accumulator>();
  for (const row of rows) {
    const kind = row.topKind;
    if (kind === 'other') continue;
    let acc = byCustomer.get(row.customerCode);
    if (acc === undefined) {
      acc = emptyAccumulator();
      byCustomer.set(row.customerCode, acc);
    }
    addBucket(acc, row, kind);
  }
  const ranked = [...byCustomer.entries()]
    .map(([customerCode, acc]): SalesHistoryCustomerRank => {
      const sales = sumTotals(acc.sales);
      const returns = sumTotals(acc.returns);
      return { customerCode, sales, returns, net: subtractTotals(sales, returns), saleNoteCount: acc.saleNotes };
    })
    .sort((a, b) => compareSignedDecimalStrings(b.net, a.net) || a.customerCode - b.customerCode);
  return limit === undefined ? ranked : ranked.slice(0, Math.max(0, limit));
}
