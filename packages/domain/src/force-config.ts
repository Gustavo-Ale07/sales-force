/**
 * Force installation parameters (owner ruling 2026-11-27: the Force keeps its own configuration, edited on the site; the ERP
 * is only a data source). Pure.
 */
export const DEFAULT_FORCE_DAYS_WITHOUT_SYNC = 7;
export const DEFAULT_FORCE_PRICE_TABLE_CODE = 5;
export const MIN_FORCE_DAYS_WITHOUT_SYNC = 1;
export const MAX_FORCE_DAYS_WITHOUT_SYNC = 60;

export interface ResolvedForceConfig {
  readonly daysWithoutSync: number;
  readonly defaultPriceTableCode: number;
}

export interface StoredForceConfig {
  readonly maxDaysWithoutSync: number | null | undefined;
  readonly defaultPriceTableCode: number | null | undefined;
}

/** A missing row or an out-of-range/invalid field falls back to the default. Table code 0 is valid. */
export function resolveForceConfig(stored: StoredForceConfig | null | undefined): ResolvedForceConfig {
  const days = stored?.maxDaysWithoutSync;
  const table = stored?.defaultPriceTableCode;
  return {
    daysWithoutSync:
      typeof days === 'number' && Number.isInteger(days) && days >= MIN_FORCE_DAYS_WITHOUT_SYNC && days <= MAX_FORCE_DAYS_WITHOUT_SYNC
        ? days
        : DEFAULT_FORCE_DAYS_WITHOUT_SYNC,
    defaultPriceTableCode: typeof table === 'number' && Number.isInteger(table) && table >= 0 ? table : DEFAULT_FORCE_PRICE_TABLE_CODE,
  };
}
