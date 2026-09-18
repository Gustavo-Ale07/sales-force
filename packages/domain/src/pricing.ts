import type { InstallationConfiguration } from './configuration.js';
import type {
  Customer,
  IsoTimestamp,
  ListPrice,
  ListPriceState,
  PriceTableVersion,
  Product,
  ResolvedPrice,
} from './entities.js';
import { isZeroDecimal, normalizeDecimalString } from './money.js';

/** Which price table applies to a customer. */
export type ResolvedPriceTable =
  | { readonly kind: 'table'; readonly code: number; readonly source: 'customer' | 'fallback' }
  | { readonly kind: 'no_resolved_table' };

/**
 * Sellability is driven purely by configuration (CFG-3): the installation must be enabled, the
 * product active, and its raw usage code must be one of the configured sellable values.
 * Empty configuration => nothing is sellable.
 */
export function isProductSellable(product: Product, config: InstallationConfiguration): boolean {
  if (!config.general.enabled) return false;
  if (!product.active) return false;
  if (product.usageCode === null) return false;
  return config.products.sellableUsageValues.includes(product.usageCode);
}

/** A price state that is not a usable positive price (explicit zero or missing). */
export function isWithoutUsablePrice(state: ListPriceState): boolean {
  return state !== 'priced';
}

/**
 * Catalog visibility: inactive products only when configured; products without a usable price
 * only when configured. Visibility is not sellability.
 */
export function isProductVisible(
  product: Product,
  config: InstallationConfiguration,
  priceState: ListPriceState = 'priced',
): boolean {
  if (!product.active && !config.products.showInactive) return false;
  if (isWithoutUsablePrice(priceState) && !config.products.productWithoutPrice.visible) return false;
  return true;
}

/**
 * Price table for a customer (CFG-4/5): the customer's own table; when absent, the fallback only
 * if both the customer policy and the pricing fallback strategy say so and a table is configured;
 * otherwise "no resolved table". A missing table is never guessed.
 */
export function resolveCustomerPriceTable(
  customer: Pick<Customer, 'priceTableCode'>,
  config: InstallationConfiguration,
): ResolvedPriceTable {
  if (customer.priceTableCode !== null) {
    return { kind: 'table', code: customer.priceTableCode, source: 'customer' };
  }
  const { pricing, customers } = config;
  if (
    customers.customerWithoutPriceTable === 'use_fallback_table' &&
    pricing.fallbackStrategy === 'fixed_table' &&
    pricing.fallbackTableCode !== null
  ) {
    return { kind: 'table', code: pricing.fallbackTableCode, source: 'fallback' };
  }
  return { kind: 'no_resolved_table' };
}

function toEpoch(value: IsoTimestamp): number {
  const epoch = Date.parse(value);
  if (Number.isNaN(epoch)) throw new RangeError(`Invalid timestamp: ${value}`);
  return epoch;
}

/** Effective version of a table at an instant: latest `effectiveFrom <= at`; ties broken by higher version id. */
export function findEffectiveVersion(
  tableCode: number,
  versions: readonly PriceTableVersion[],
  at: IsoTimestamp,
): PriceTableVersion | null {
  const atEpoch = toEpoch(at);
  let best: PriceTableVersion | null = null;
  let bestEpoch = Number.NEGATIVE_INFINITY;
  for (const version of versions) {
    if (version.tableCode !== tableCode) continue;
    const epoch = toEpoch(version.effectiveFrom);
    if (epoch > atEpoch) continue;
    if (epoch > bestEpoch || (epoch === bestEpoch && best !== null && version.versionId > best.versionId)) {
      best = version;
      bestEpoch = epoch;
    }
  }
  return best;
}

export interface ResolveListPriceInput {
  readonly productCode: number;
  readonly table: ResolvedPriceTable;
  readonly versions: readonly PriceTableVersion[];
  /** Lookup of the mirrored price row; `undefined` = no row (=> price state `none`). */
  readonly findPrice: (versionId: number, productCode: number) => ListPrice | undefined;
  /** Injected instant (the domain never reads the clock). */
  readonly at: IsoTimestamp;
}

/**
 * List price for a product in a resolved table at an instant.
 * A missing row is `none`, an explicit zero row is `zero`, a positive value is `priced`.
 * Missing is never converted to zero.
 */
export function resolveListPrice(input: ResolveListPriceInput): ResolvedPrice {
  if (input.table.kind === 'no_resolved_table') {
    return { state: 'none', reason: 'no_resolved_table', tableCode: null, versionId: null };
  }
  const tableCode = input.table.code;
  const version = findEffectiveVersion(tableCode, input.versions, input.at);
  if (!version) {
    return { state: 'none', reason: 'no_effective_version', tableCode, versionId: null };
  }
  const row = input.findPrice(version.versionId, input.productCode);
  if (!row) {
    return { state: 'none', reason: 'no_price_row', tableCode, versionId: version.versionId };
  }
  // Malformed or negative values throw RangeError: mirrored data is validated at the boundary.
  if (isZeroDecimal(row.unitPrice)) {
    return { state: 'zero', unitPrice: '0', tableCode, versionId: version.versionId };
  }
  return {
    state: 'priced',
    unitPrice: normalizeDecimalString(row.unitPrice),
    tableCode,
    versionId: version.versionId,
  };
}

/**
 * Whether an order line with this price state may be placed in a draft (server-side rule).
 * Priced lines always; zero/missing only when configuration allows both drafting without a price
 * and ordering products without a price.
 */
export function isLineOrderable(state: ListPriceState, config: InstallationConfiguration): boolean {
  if (state === 'priced') return true;
  return (
    config.sales.orderBehavior.allowDraftWithoutPrice &&
    config.products.productWithoutPrice.orderable
  );
}
