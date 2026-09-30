import type { MobilityFilter } from './configuration.js';

/**
 * Installation-configured mobility filter over a product's raw mobility code. The source column, the
 * allowed values and whether the filter applies at all are configuration (CFG-1); nothing customer
 * specific lives here. A filter applies only when `mode` is `enforced` AND `validation` is
 * `validated` (configuration consistency also rejects enforced + unvalidated); otherwise it never
 * blocks. When it applies, a blank or unread code is NOT allowed: visibility is never guessed.
 */
export function isProductMobilityAllowed(
  product: { readonly mobilityCode?: string | null },
  filter: MobilityFilter | undefined,
): boolean {
  if (filter === undefined || filter.mode !== 'enforced' || filter.validation !== 'validated') return true;
  const code = product.mobilityCode;
  return code !== undefined && code !== null && filter.allowedValues.includes(code);
}
