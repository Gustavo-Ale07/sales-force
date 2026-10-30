import { SankhyaGatewayError, type SankhyaErrorKind } from './errors.js';

/**
 * RAW FACTS read from the Sankhya-side Vidya configuration (CFG-8; spike §9.49). Typed rows per query
 * Q1-Q8 with per-query success/failure and the table/columns each came from. No mapping into the
 * Sales Force configuration snapshot happens here: the server overlays these facts on the base file.
 *
 * Conventions: `S`/`N` flags become `boolean`; a NULL cell is `null` meaning "not read", NEVER `false`.
 * This module has no dependency on `packages/contracts`.
 */

export type ConfigQueryId = 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Q5' | 'Q6' | 'Q7' | 'Q8';

export const CONFIG_QUERY_IDS: readonly ConfigQueryId[] = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8'];

/** Where a query's facts come from (for the server's provenance map). */
export interface ConfigQuerySource {
  readonly tables: readonly string[];
  /** Columns the query reads, in query order (aliases resolved to the column name). */
  readonly columns: readonly string[];
  /** Fixed row filter, when the query has one (for example `NUCFG = 1`). */
  readonly filter?: string;
}

export interface ConfigQueryFailure {
  readonly kind: SankhyaErrorKind;
  readonly code: string;
  /** Secret-free message (no values, no response bodies). */
  readonly message: string;
  readonly retryable: boolean;
}

export type ConfigQueryResult<T> =
  | { readonly ok: true; readonly source: ConfigQuerySource; readonly rows: readonly T[] }
  | { readonly ok: false; readonly source: ConfigQuerySource; readonly error: ConfigQueryFailure };

/** Report-only cell whose type is not validated; never interpreted. */
export type ConfigScalar = string | number | null;

/** Q1: the single `AD_TVDYCFGFRC` row with `NUCFG = 1`. */
export interface GeneralParametersRow {
  readonly nucfg: number;
  /** CODLOCALPEDIDOS */
  readonly orderStockLocationCode: number | null;
  /** TABPADCSLTPROD */
  readonly catalogReferenceTableCode: number | null;
  /** CODTABALT */
  readonly alternativeTableCode: number | null;
  /** USADECQTD */
  readonly decimalQuantities: boolean | null;
  /** DIASCONSULTAVENDAS */
  readonly historyDays: number | null;
  /** QTDDIASPRODCOMPRADOS */
  readonly purchasedWindowDays: number | null;
  /** UTILFINANC: read and reported only until the financial area exists. */
  readonly usesFinancial: boolean | null;
  /** OCLTLIMCRED: true = the ERP hides the credit limit. */
  readonly hidesCreditLimit: boolean | null;
  /** Remaining Q1 columns, report-only, keyed by column name. */
  readonly informational: Readonly<Record<string, ConfigScalar>>;
}

/** Q2: `TSIEMP`. */
export interface CompanyRow {
  readonly companyCode: number;
  readonly tradeName: string | null;
  /** AD_MOBILIDADE */
  readonly mobile: boolean | null;
  /** AD_CODTIPOPERPAD */
  readonly defaultOrderTopCode: number | null;
}

/** Q3: current version (`MAX(DHALTER)`) of each `TGFTOP` with `AD_MOBILIDADE = S`. */
export interface EnabledTopRow {
  readonly topCode: number;
  readonly description: string | null;
  /** TIPMOV (P = order, per the mapping rule). */
  readonly movementType: string | null;
  readonly mobile: boolean | null;
  /** AD_PULARCONFIRMACAO */
  readonly skipConfirmation: boolean | null;
  /** AD_PERMITEFATURARAPP: reported only. */
  readonly allowInvoiceInApp: boolean | null;
  /** `YYYY-MM-DD HH24:MI:SS` in the ERP clock. */
  readonly changedAt: string | null;
}

/** Q4: Vidya TOP groups (quote x order), one row per (group, TOP). */
export interface TopGroupRow {
  readonly groupId: number;
  readonly groupName: string;
  readonly order: number | null;
  readonly topCode: number;
}

/** Q5: current version of each `TGFTPV` with `AD_MOBILIDADE = S`. */
export interface NegotiationTypeRow {
  readonly code: number;
  readonly description: string | null;
  readonly active: boolean | null;
  readonly mobile: boolean | null;
  /** AD_VENDA: reported only. */
  readonly sale: boolean | null;
  readonly changedAt: string | null;
}

/** Q6: `TGFNTA`. */
export interface PriceTableFlagRow {
  readonly tableCode: number;
  readonly mobile: boolean | null;
}

/** Q7: `AD_TVDYFRCSTS` order status presentation. */
export interface OrderStatusRow {
  readonly code: number;
  readonly name: string | null;
  readonly description: string | null;
  /** COR: hex colour as stored (the server adds the `#`). */
  readonly color: string | null;
  readonly canEdit: boolean | null;
  readonly canDuplicate: boolean | null;
  readonly canDelete: boolean | null;
}

/** Q8: distribution of `TGFPRO.AD_MOBILIDADE` (report only, decides nothing). */
export interface ProductMobilityRow {
  /** null = the column is NULL for these products. */
  readonly mobile: boolean | null;
  readonly count: number;
}

export interface ConfigurationFacts {
  /** ISO instant the read started (injected clock). */
  readonly readAt: string;
  readonly q1GeneralParameters: ConfigQueryResult<GeneralParametersRow>;
  readonly q2Companies: ConfigQueryResult<CompanyRow>;
  readonly q3EnabledTops: ConfigQueryResult<EnabledTopRow>;
  readonly q4TopGroups: ConfigQueryResult<TopGroupRow>;
  readonly q5NegotiationTypes: ConfigQueryResult<NegotiationTypeRow>;
  readonly q6PriceTables: ConfigQueryResult<PriceTableFlagRow>;
  readonly q7OrderStatuses: ConfigQueryResult<OrderStatusRow>;
  readonly q8ProductMobility: ConfigQueryResult<ProductMobilityRow>;
}

export interface FailedConfigQuery {
  readonly id: ConfigQueryId;
  readonly error: ConfigQueryFailure;
}

const RESULT_KEYS: readonly (readonly [ConfigQueryId, keyof Omit<ConfigurationFacts, 'readAt'>])[] = [
  ['Q1', 'q1GeneralParameters'],
  ['Q2', 'q2Companies'],
  ['Q3', 'q3EnabledTops'],
  ['Q4', 'q4TopGroups'],
  ['Q5', 'q5NegotiationTypes'],
  ['Q6', 'q6PriceTables'],
  ['Q7', 'q7OrderStatuses'],
  ['Q8', 'q8ProductMobility'],
];

/** Every query that failed, in Q1..Q8 order. Empty = the read is complete. */
export function failedConfigQueries(facts: ConfigurationFacts): readonly FailedConfigQuery[] {
  const failed: FailedConfigQuery[] = [];
  for (const [id, key] of RESULT_KEYS) {
    const result = facts[key];
    if (!result.ok) failed.push({ id, error: result.error });
  }
  return failed;
}

/**
 * Throws a classified `SankhyaGatewayError` when any query failed: the configuration is all-or-nothing
 * (CFG-8), so the caller must keep the current version. The kind and retryability are those of the
 * first failure.
 */
export function assertConfigurationFactsComplete(facts: ConfigurationFacts): void {
  const failed = failedConfigQueries(facts);
  const first = failed[0];
  if (first === undefined) return;
  throw new SankhyaGatewayError(first.error.kind, {
    code: 'configuration_query_failed',
    message: `Configuration read incomplete: ${failed.map((f) => `${f.id} (${f.error.code})`).join(', ')}. Nothing was applied.`,
  });
}

/** `S` -> true, `N` -> false, NULL/blank -> null ("not read", never false). Anything else is `undefined` (invalid). */
export function flagToBoolean(value: string | null | undefined): boolean | null | undefined {
  if (value === null || value === undefined || value.trim() === '') return null;
  if (value === 'S') return true;
  if (value === 'N') return false;
  return undefined;
}

/** Accent-free upper case, for comparing the Vidya group name (`ORÇAMENTO` -> `ORCAMENTO`). */
export function normalizeGroupName(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().trim();
}

/** True for the Vidya group named ORÇAMENTO (accent- and case-insensitive). */
export function isQuoteGroupName(name: string): boolean {
  return normalizeGroupName(name) === 'ORCAMENTO';
}
