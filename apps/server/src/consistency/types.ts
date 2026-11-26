import type { MirrorEntity } from '../sync/mirror-entities.js';

/** Row mirrors the verifier compares by the mirror's own content hash (sales history is an atomic replacement, not verified here). */
export const MIRROR_CONSISTENCY_TYPES = [
  'sellers',
  'directoryUsers',
  'customers',
  'products',
  'productGroups',
  'priceTables',
  'priceTableVersions',
  'listPrices',
  'carriers',
  'ipiRates',
  'openTitles',
  'cities',
  'neighborhoods',
  'streets',
  'postalCodes',
] as const satisfies readonly MirrorEntity[];
export type MirrorConsistencyType = (typeof MIRROR_CONSISTENCY_TYPES)[number];

/** TOPs and negotiation types live in the installation configuration (CFG-8); orders/status/releases are read by NUNOTA. */
export const CONFIGURATION_CONSISTENCY_TYPES = ['tops', 'negotiationTypes', 'configuration'] as const;
export const ORDER_CONSISTENCY_TYPES = ['orders', 'orderStatus', 'releases'] as const;

export const CONSISTENCY_TYPES = [...MIRROR_CONSISTENCY_TYPES, ...CONFIGURATION_CONSISTENCY_TYPES, ...ORDER_CONSISTENCY_TYPES] as const;
export type ConsistencyType = (typeof CONSISTENCY_TYPES)[number];

export function isConsistencyType(value: string): value is ConsistencyType {
  return (CONSISTENCY_TYPES as readonly string[]).includes(value);
}
export function isMirrorConsistencyType(value: ConsistencyType): value is MirrorConsistencyType {
  return (MIRROR_CONSISTENCY_TYPES as readonly string[]).includes(value);
}

/**
 * How the check of one type ended. Only `checked` carries trustworthy counts; every other status reports zero differences on
 * purpose: a failed or suspicious read must never be turned into "extra in Force" (it would look like a mass deletion).
 */
export type ConsistencyStatus =
  | 'checked'
  /** The Sankhya read failed or was incomplete; nothing was compared. */
  | 'read_failed'
  /** The entity lock was held (a mirror run of that entity is in progress); the type was skipped, not failed. */
  | 'skipped_locked'
  /** The gateway cannot read this type. */
  | 'unsupported'
  /** Sankhya returned nothing while the mirror holds live rows: the same fail-closed pattern as the mirror's `empty_snapshot`. */
  | 'suspect_empty_source'
  /** Nothing to compare in this installation (for example no order has been sent to the ERP). */
  | 'not_configured';

export interface ConsistencySamples {
  readonly missing: readonly string[];
  readonly extra: readonly string[];
  readonly divergent: readonly string[];
}

export interface ConsistencyTypeReport {
  readonly type: ConsistencyType;
  readonly status: ConsistencyStatus;
  /** Rows (or items) Sankhya returned now / live rows in the Force. Null when not read. */
  readonly sourceCount: number | null;
  readonly mirrorCount: number | null;
  /** In Sankhya's current read, absent (or soft-deleted) in the Force. */
  readonly missing: number;
  /** Live in the Force, no longer returned by the current Sankhya read (deleted, inactivated, out of scope). */
  readonly extra: number;
  /** In both, with different stored content. */
  readonly divergent: number;
  /** Identifiers only, capped by `sampleLimit`. */
  readonly samples: ConsistencySamples;
  /** Rows left out by the read's own eligibility rules (counts per criterion), as the mirror job reports them. */
  readonly excluded?: Readonly<Record<string, number>>;
  /** Stable error class/code or a reason; never a message that could carry data. */
  readonly detail?: string;
  /** When the mirror last finished a successful sync of this type (`sync_state`); a difference younger than the cron is expected. */
  readonly lastSuccessfulSyncAt?: string | null;
  readonly durationMs: number;
}

export interface ConsistencyReport {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly gatewayMode: string;
  readonly sampleLimit: number;
  readonly types: readonly ConsistencyTypeReport[];
  readonly totals: { readonly missing: number; readonly extra: number; readonly divergent: number };
  /** True when every requested type was `checked` and no difference exists. */
  readonly consistent: boolean;
  /** True when at least one type could not be fully checked. */
  readonly incomplete: boolean;
}

export type DifferenceKind = 'missing' | 'extra' | 'divergent';

/** Full (uncapped) lists of one comparison; the verifier caps them for the report and the log. */
export interface Differences {
  readonly missing: readonly string[];
  readonly extra: readonly string[];
  readonly divergent: readonly string[];
}

export const EMPTY_DIFFERENCES: Differences = { missing: [], extra: [], divergent: [] };

/** What one type's check hands back to the verifier (which adds timing, sync time, logging and capping). */
export interface TypeOutcome {
  readonly status: ConsistencyStatus;
  readonly sourceCount: number | null;
  readonly mirrorCount: number | null;
  readonly differences: Differences;
  readonly excluded?: Readonly<Record<string, number>>;
  readonly detail?: string;
}

export function noComparison(status: Exclude<ConsistencyStatus, 'checked'>, detail?: string): TypeOutcome {
  return { status, sourceCount: null, mirrorCount: null, differences: EMPTY_DIFFERENCES, ...(detail === undefined ? {} : { detail }) };
}
