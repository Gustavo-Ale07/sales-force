import { compareDecimalStrings, isDecimalString, normalizeDecimalString, type DecimalString } from './money.js';

/**
 * Per-seller discount limit (owner ruling 2026-11-26, replaces "limit only from DESCMAX"). The same code runs on the
 * server (revalidation, P-08/P-21) and in web and mobile (editor, offline). Pure and deterministic (P-14); no cost or
 * margin is read or returned (P-20).
 *
 * Resolution, innermost first: product rule > rule of the nearest ancestor group of the product (child before parent,
 * any depth) > seller general limit > the product's own ERP ceiling (DESCMAX) > no limit.
 */

export type SellerDiscountRuleKind = 'general' | 'group' | 'product';

export interface SellerDiscountRule {
  readonly kind: SellerDiscountRuleKind;
  /** Group code or product code; `null` for the general rule. */
  readonly code: number | null;
  /** Percent as decimal text (0 to 99.99). Zero is a real limit: no discount. */
  readonly percent: DecimalString;
}

export interface SellerDiscountRuleIndex {
  readonly general: DecimalString | null;
  readonly groups: ReadonlyMap<number, DecimalString>;
  readonly products: ReadonlyMap<number, DecimalString>;
}

export type SellerDiscountLimitSource = 'product' | 'group' | 'general' | 'erp_product' | 'none';

export interface ResolvedSellerDiscountLimit {
  readonly limit: DecimalString | null;
  readonly source: SellerDiscountLimitSource;
  /** The group whose rule applied (`source: 'group'`). */
  readonly groupCode?: number;
}

export function indexSellerDiscountRules(rules: readonly SellerDiscountRule[]): SellerDiscountRuleIndex {
  let general: DecimalString | null = null;
  const groups = new Map<number, DecimalString>();
  const products = new Map<number, DecimalString>();
  for (const rule of rules) {
    if (!isDecimalString(rule.percent)) continue;
    const percent = normalizeDecimalString(rule.percent);
    if (rule.kind === 'general') general = percent;
    else if (rule.code !== null && rule.kind === 'group') groups.set(rule.code, percent);
    else if (rule.code !== null && rule.kind === 'product') products.set(rule.code, percent);
  }
  return { general, groups, products };
}

export interface ResolveSellerDiscountLimitInput {
  readonly productCode: number;
  readonly groupCode: number | null;
  /** DESCMAX of the product as mirrored; null, absent or unparseable = none registered. */
  readonly erpMaxPercent: string | null | undefined;
  readonly rules: SellerDiscountRuleIndex;
  /** Parent group code from the mirrored tree, `null` at the top. */
  readonly parentOf: (groupCode: number) => number | null;
}

const MAX_TREE_DEPTH = 32;

export function resolveSellerDiscountLimit(input: ResolveSellerDiscountLimitInput): ResolvedSellerDiscountLimit {
  const fromProduct = input.rules.products.get(input.productCode);
  if (fromProduct !== undefined) return { limit: fromProduct, source: 'product' };

  const seen = new Set<number>();
  let current = input.groupCode;
  for (let depth = 0; current !== null && current > 0 && depth < MAX_TREE_DEPTH && !seen.has(current); depth += 1) {
    const fromGroup = input.rules.groups.get(current);
    if (fromGroup !== undefined) return { limit: fromGroup, source: 'group', groupCode: current };
    seen.add(current);
    current = input.parentOf(current);
  }

  if (input.rules.general !== null) return { limit: input.rules.general, source: 'general' };

  const erp = input.erpMaxPercent;
  if (typeof erp === 'string' && erp.trim() !== '' && isDecimalString(erp.trim())) {
    return { limit: normalizeDecimalString(erp.trim()), source: 'erp_product' };
  }
  return { limit: null, source: 'none' };
}

/** True when `discountPercent` is strictly above `limit`; no limit never exceeds. Both must be decimal text. */
export function discountExceedsLimit(discountPercent: DecimalString, limit: DecimalString | null): boolean {
  if (limit === null || !isDecimalString(discountPercent) || !isDecimalString(limit)) return false;
  return compareDecimalStrings(discountPercent, limit) > 0;
}
