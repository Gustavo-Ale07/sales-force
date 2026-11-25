import type { MobilityFilter } from './configuration.js';

/**
 * Installation-configured mobility filter over a product's raw mobility code. The source column, the
 * allowed values and whether the filter applies at all are configuration (CFG-1); nothing customer
 * specific lives here. A filter applies only when `mode` is `enforced` AND `validation` is
 * `validated` (configuration consistency also rejects enforced + unvalidated); otherwise it never
 * blocks. When it applies, a blank or unread code is NOT allowed: visibility is never guessed.
 */
export interface MobilityTally {
  readonly visible: number;
  readonly hidden: number;
}

export type MobilityGuardReason = 'all_hidden';

export interface MobilityGuardVerdict {
  readonly keepPrevious: boolean;
  readonly reason: MobilityGuardReason | null;
}

/** Visible = mobility `S` (true); `N`, blank and unread (false/null/undefined) are hidden. */
export function mobilityTally(flags: Iterable<boolean | null | undefined>): MobilityTally {
  let visible = 0;
  let hidden = 0;
  for (const flag of flags) {
    if (flag === true) visible += 1;
    else hidden += 1;
  }
  return { visible, hidden };
}

/**
 * Anti-empty-catalog guard: a refresh that would hide EVERYTHING is far more likely a broken or unfilled
 * `AD_MOBILIDADE` than a real decision: the caller KEEPS the previous data and warns. A small enabled set is legitimate
 * (owner 2026-11-25: Sankhya may enable only a handful of TOPs), so no percentage limit applies. Nothing read at all
 * (0 + 0) is not a guard case.
 */
export function evaluateMobilityGuard(tally: MobilityTally): MobilityGuardVerdict {
  const total = tally.visible + tally.hidden;
  if (total === 0) return { keepPrevious: false, reason: null };
  if (tally.visible === 0) return { keepPrevious: true, reason: 'all_hidden' };
  return { keepPrevious: false, reason: null };
}

export function isProductMobilityAllowed(
  product: { readonly mobilityCode?: string | null },
  filter: MobilityFilter | undefined,
): boolean {
  if (filter === undefined || filter.mode !== 'enforced' || filter.validation !== 'validated') return true;
  const code = product.mobilityCode;
  return code !== undefined && code !== null && filter.allowedValues.includes(code);
}
