import type { IsoTimestamp, PriceTableVersion } from '@salesforce/domain';

/**
 * Installation-derived limits on what a mirror read returns (CFG-1…6). The gateway never decides them:
 * the caller derives them from the current installation configuration. All of it is optional; a read
 * without scope returns everything the validated contract allows (except placeholder rows).
 */
export interface ReadScope {
  /** Product filters: only sellable, active, real (CODPROD > 0) products are mirrored. */
  readonly products?: {
    /** Sellable usage codes (`products.sellableUsageValues`). An empty list selects nothing. */
    readonly usageValues: readonly string[];
    /** Default `true`: inactive products are not mirrored. */
    readonly activeOnly?: boolean;
    /** Name of the ERP field holding the mobility flag, read raw into `Product.mobilityCode`. */
    readonly mobilitySourceField?: string | null;
  };
  /** Price tables to mirror (`pricing.mobilePriceTableCodes`). Applies to tables, versions and list prices. */
  readonly priceTableCodes?: readonly number[];
  /** Clock used to pick each table's current price-table version. Default: the gateway clock. */
  readonly now?: IsoTimestamp;
}

const USAGE_VALUE_RE = /^[A-Za-z0-9]{1,5}$/;
const FIELD_NAME_RE = /^[A-Z][A-Z0-9_]{0,29}$/;

/** Fails closed on anything that could not be a plain usage code / field name (values reach SQL text). */
export function assertSafeScope(scope: ReadScope | undefined): void {
  if (scope === undefined) return;
  for (const value of scope.products?.usageValues ?? []) {
    if (!USAGE_VALUE_RE.test(value)) throw new RangeError('scope.products.usageValues contains an invalid value');
  }
  const field = scope.products?.mobilitySourceField;
  if (field !== undefined && field !== null && !FIELD_NAME_RE.test(field)) {
    throw new RangeError('scope.products.mobilitySourceField is not a valid field name');
  }
  for (const code of scope.priceTableCodes ?? []) {
    if (!Number.isSafeInteger(code) || code < 0) throw new RangeError('scope.priceTableCodes contains an invalid code');
  }
}

/**
 * Per table: the version with the latest `effectiveFrom` not after `now` (the current one), plus every
 * version that starts later. Superseded versions are dropped so old prices never mix with the current
 * ones. Ties on `effectiveFrom` resolve to the highest `versionId`. Input order is irrelevant; output
 * is ordered by `versionId`.
 */
export function selectEffectiveVersions(
  versions: readonly PriceTableVersion[],
  now: IsoTimestamp,
): PriceTableVersion[] {
  const nowMs = Date.parse(now);
  const current = new Map<number, PriceTableVersion>();
  const future: PriceTableVersion[] = [];
  for (const version of versions) {
    if (Date.parse(version.effectiveFrom) > nowMs) {
      future.push(version);
      continue;
    }
    const best = current.get(version.tableCode);
    if (
      best === undefined ||
      version.effectiveFrom > best.effectiveFrom ||
      (version.effectiveFrom === best.effectiveFrom && version.versionId > best.versionId)
    ) {
      current.set(version.tableCode, version);
    }
  }
  return [...current.values(), ...future].sort((a, b) => a.versionId - b.versionId);
}
