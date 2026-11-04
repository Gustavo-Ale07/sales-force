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
    /**
     * D-S/D-V: when set together with `mobilitySourceField`, only products whose raw mobility value is in
     * this list are mirrored (the filter runs at the source; a blank value never matches).
     */
    readonly mobilityAllowedValues?: readonly string[];
  };
  /**
   * D-V: which partners are mirrored as customers (`customers.eligibility`). Absent = the previous rule
   * (flag CLIENTE only). The gateway checks the columns exist in the ERP schema and fails closed naming them.
   */
  readonly customers?: CustomerEligibilityScope;
  /** Price tables to mirror (`pricing.mobilePriceTableCodes`). Applies to tables, versions and list prices. */
  readonly priceTableCodes?: readonly number[];
  /** Clock used to pick each table's current price-table version. Default: the gateway clock. */
  readonly now?: IsoTimestamp;
}

export interface CustomerEligibilityScope {
  readonly activeOnly: boolean;
  readonly requiredFlags: readonly string[];
  readonly columnIn: readonly { readonly column: string; readonly values: readonly string[] }[];
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
  const allowed = scope.products?.mobilityAllowedValues;
  if (allowed !== undefined) {
    if (allowed.length === 0 || field === undefined || field === null) {
      throw new RangeError('scope.products.mobilityAllowedValues needs a source field and at least one value');
    }
    for (const value of allowed) {
      if (!USAGE_VALUE_RE.test(value)) throw new RangeError('scope.products.mobilityAllowedValues contains an invalid value');
    }
  }
  for (const flag of scope.customers?.requiredFlags ?? []) {
    if (!FIELD_NAME_RE.test(flag)) throw new RangeError("scope.customers.requiredFlags contains an invalid column name");
  }
  for (const rule of scope.customers?.columnIn ?? []) {
    if (!FIELD_NAME_RE.test(rule.column)) throw new RangeError("scope.customers.columnIn contains an invalid column name");
    if (rule.values.length === 0) throw new RangeError("scope.customers.columnIn needs at least one value per column");
    for (const value of rule.values) {
      if (!USAGE_VALUE_RE.test(value)) throw new RangeError("scope.customers.columnIn contains an invalid value");
    }
  }
  for (const code of scope.priceTableCodes ?? []) {
    if (!Number.isSafeInteger(code) || code < 0) throw new RangeError('scope.priceTableCodes contains an invalid code');
  }
}

/** Why a partner is left out of the customer mirror; one entry per criterion (the first that fails). */
export type CustomerExclusion = `active` | `flag:${string}` | `column:${string}`;

/**
 * Shared eligibility rule (the real gateway applies it row by row, the fake over `attributes`). A blank or
 * missing attribute never satisfies a flag or a column rule. Returns the first failing criterion or null.
 */
export function customerExclusion(
  active: boolean,
  attribute: (column: string) => string | null | undefined,
  rules: CustomerEligibilityScope,
): CustomerExclusion | null {
  if (rules.activeOnly && !active) return `active`;
  for (const flag of rules.requiredFlags) if (attribute(flag) !== `S`) return `flag:${flag}`;
  for (const rule of rules.columnIn) {
    const value = attribute(rule.column);
    if (value === undefined || value === null || !rule.values.includes(value)) return `column:${rule.column}`;
  }
  return null;
}

/** Mobility rule shared by the fake gateway: no list = no filter; a blank or unread value never matches. */
export function mobilityAllowed(code: string | null | undefined, allowed: readonly string[] | undefined): boolean {
  if (allowed === undefined) return true;
  return code !== undefined && code !== null && allowed.includes(code);
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
