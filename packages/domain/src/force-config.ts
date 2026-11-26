import type { ForceConfig, ForceDiscountLimit } from './entities.js';
import type { SellerDiscountRule } from './seller-discount-limit.js';

/** Installation parameters read from the ERP (AD_FORCECFG). Defaults apply when the table, the row or the field is empty. */
export const DEFAULT_FORCE_DAYS_WITHOUT_SYNC = 7;
export const DEFAULT_FORCE_PRICE_TABLE_CODE = 5;

export interface ResolvedForceConfig {
  readonly daysWithoutSync: number;
  readonly defaultPriceTableCode: number;
}

/** First row (lowest id) wins; a missing row or an empty/invalid field falls back to the default. Pure. */
export function resolveForceConfig(rows: readonly ForceConfig[]): ResolvedForceConfig {
  const first = [...rows].sort((a, b) => a.id - b.id)[0];
  const days = first?.daysWithoutSync;
  const table = first?.defaultPriceTableCode;
  return {
    daysWithoutSync: typeof days === 'number' && Number.isInteger(days) && days >= 1 ? days : DEFAULT_FORCE_DAYS_WITHOUT_SYNC,
    defaultPriceTableCode: typeof table === 'number' && Number.isInteger(table) && table >= 0 ? table : DEFAULT_FORCE_PRICE_TABLE_CODE,
  };
}

/**
 * The rules ONE seller has in the ERP: product rows (CODPROD filled), group rows (only CODGRUPOPROD) and the seller's general
 * ceiling. Other sellers' rows never enter. A row with neither product nor group is not a rule.
 */
export function sellerRulesFromErp(
  sellerCode: number,
  generalPercent: string | null | undefined,
  rows: readonly ForceDiscountLimit[],
): SellerDiscountRule[] {
  const rules: SellerDiscountRule[] = [];
  if (typeof generalPercent === 'string' && generalPercent.trim() !== '') rules.push({ kind: 'general', code: null, percent: generalPercent.trim() });
  for (const row of [...rows].sort((a, b) => a.configId - b.configId || a.seq - b.seq)) {
    if (row.sellerCode !== sellerCode) continue;
    if (row.productCode !== null && row.productCode > 0) rules.push({ kind: 'product', code: row.productCode, percent: row.percent });
    else if (row.groupCode !== null && row.groupCode > 0) rules.push({ kind: 'group', code: row.groupCode, percent: row.percent });
  }
  return rules;
}
