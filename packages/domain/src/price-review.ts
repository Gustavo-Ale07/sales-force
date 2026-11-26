import { decimalEquals } from './money.js';
import type { DecimalString } from './money.js';

/**
 * Item-by-item price review (P-09): pure rules. A missing price (`null`) is never zero, so it always differs from a number.
 */

export function pricesDiffer(previous: DecimalString | null, current: DecimalString | null): boolean {
  if (previous === null || current === null) return previous !== current;
  return !decimalEquals(previous, current);
}

export type PriceReviewChoice = 'accept' | 'refuse';

export interface PriceReviewDecisionInput {
  readonly lineNo: number;
  readonly decision: PriceReviewChoice;
}

export type PriceReviewResolution =
  | { readonly ok: true; readonly refused: number[] }
  | { readonly ok: false; readonly reason: 'missing_decision' | 'unknown_line' | 'duplicate_decision'; readonly lineNos: number[] };

/** Every reviewed line needs exactly one decision and nothing else may be decided. Returns the lines to remove. */
export function resolvePriceReview(reviewedLineNos: readonly number[], decisions: readonly PriceReviewDecisionInput[]): PriceReviewResolution {
  const reviewed = new Set(reviewedLineNos);
  const seen = new Set<number>();
  const duplicates: number[] = [];
  const unknown: number[] = [];
  for (const entry of decisions) {
    if (!reviewed.has(entry.lineNo)) unknown.push(entry.lineNo);
    else if (seen.has(entry.lineNo)) duplicates.push(entry.lineNo);
    seen.add(entry.lineNo);
  }
  if (unknown.length > 0) return { ok: false, reason: 'unknown_line', lineNos: unknown };
  if (duplicates.length > 0) return { ok: false, reason: 'duplicate_decision', lineNos: duplicates };
  const missing = reviewedLineNos.filter((lineNo) => !seen.has(lineNo));
  if (missing.length > 0) return { ok: false, reason: 'missing_decision', lineNos: missing };
  return { ok: true, refused: decisions.filter((entry) => entry.decision === 'refuse').map((entry) => entry.lineNo) };
}
