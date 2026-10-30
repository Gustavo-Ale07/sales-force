import { compareDecimalStrings, isDecimalString, type DecimalString } from './money.js';

/**
 * Validity of an order's lines before it is queued for the ERP (SNK-7 D-M, D-8). Pure and deterministic.
 *
 * It is deliberately structural: it never decides whether a discount is allowed (that is the ERP's own
 * rule in `erp` mode, or the Sales Force discount authority in `force` mode, decided elsewhere). It only
 * refuses what cannot be sent at all: a discount outside 0-99.99 %, a line without a price ("Sem preço":
 * missing price is never 0, P-09) and a line without a unit of measure.
 */
export type OrderErpIssueCode = 'discount_out_of_range' | 'no_price' | 'zero_price' | 'missing_unit' | 'no_items';

export interface OrderErpLine {
  readonly lineNo: number;
  readonly discountPercent: DecimalString;
  readonly priceState: 'priced' | 'zero' | 'none';
  readonly unit: string | null;
}

export interface OrderErpIssue {
  readonly code: OrderErpIssueCode;
  /** 1-based line number; 0 for an order-level issue. */
  readonly lineNo: number;
}

const MAX_DISCOUNT = '99.99';

/** Every problem found, in line order (empty = structurally sendable). */
export function orderErpIssues(lines: readonly OrderErpLine[]): readonly OrderErpIssue[] {
  if (lines.length === 0) return [{ code: 'no_items', lineNo: 0 }];
  const issues: OrderErpIssue[] = [];
  for (const line of lines) {
    if (
      !isDecimalString(line.discountPercent) ||
      compareDecimalStrings(line.discountPercent, '0') < 0 ||
      compareDecimalStrings(line.discountPercent, MAX_DISCOUNT) > 0
    ) {
      issues.push({ code: 'discount_out_of_range', lineNo: line.lineNo });
    }
    if (line.priceState === 'none') issues.push({ code: 'no_price', lineNo: line.lineNo });
    else if (line.priceState === 'zero') issues.push({ code: 'zero_price', lineNo: line.lineNo });
    if (line.unit === null || line.unit.trim() === '') issues.push({ code: 'missing_unit', lineNo: line.lineNo });
  }
  return issues;
}
