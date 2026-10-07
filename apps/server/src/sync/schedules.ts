import type { MirrorEntity } from './mirror-entities.js';

/**
 * Default cron of each mirror job. These are the frequencies PROPOSED by the spec (RF-SNK-1) and
 * recorded in `docs/sankhya-spike.md` §4; they stay proposals until the Sankhya request limits are
 * measured (S0.2, spike §5). Overridable per installation with the `SYNC_CRON_*` variables.
 */
export const DEFAULT_MIRROR_CRONS = {
  sellers: '*/15 * * * *',
  customers: '*/10 * * * *',
  products: '*/15 * * * *',
  prices: '*/10 * * * *',
} as const;

export interface MirrorScheduleSettings {
  readonly SYNC_MIRROR_ENABLED: boolean;
  readonly SYNC_CRON_SELLERS: string;
  readonly SYNC_CRON_CUSTOMERS: string;
  readonly SYNC_CRON_PRODUCTS: string;
  readonly SYNC_CRON_PRICES: string;
}

/** `null` = the entity has no schedule (disabled); it can still be run by hand (`sync:once`). */
export type MirrorSchedules = Readonly<Record<MirrorEntity, string | null>>;

export function mirrorSchedulesFromSettings(settings: MirrorScheduleSettings): MirrorSchedules {
  if (!settings.SYNC_MIRROR_ENABLED) {
    return { sellers: null, customers: null, products: null, priceTables: null, priceTableVersions: null, listPrices: null, directoryUsers: null };
  }
  return {
    sellers: settings.SYNC_CRON_SELLERS,
    customers: settings.SYNC_CRON_CUSTOMERS,
    products: settings.SYNC_CRON_PRODUCTS,
    // One knob for the whole price model: tables, versions and list prices move together.
    priceTables: settings.SYNC_CRON_PRICES,
    priceTableVersions: settings.SYNC_CRON_PRICES,
    listPrices: settings.SYNC_CRON_PRICES,
    // The user -> seller relation moves with the seller list: one knob.
    directoryUsers: settings.SYNC_CRON_SELLERS,
  };
}
