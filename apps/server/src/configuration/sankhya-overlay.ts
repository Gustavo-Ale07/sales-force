import type {
  ConfigQueryResult,
  ConfigScalar,
  ConfigurationFacts,
  ConfigQuerySource,
} from '@salesforce/sankhya';
import { isQuoteGroupName } from '@salesforce/sankhya';
import type { ConfigurationProvenanceEntry, InstallationConfiguration, OrderStatusDisplay } from '@salesforce/domain';
import { PermanentJobError } from '../worker/job-contract.js';
import { canonicalJson } from './configuration-hash.js';

/**
 * Overlay of the Sankhya-side Vidya configuration on the base file (CFG-8, U-10-a..d, U-11; Part 2 D2/D3).
 *
 *   snapshot = base (+) facts
 *
 * PURE: no I/O, no clock (the facts carry `readAt`). Rules, exactly:
 * - a bridge key read successfully from Sankhya overrides the base; a NULL cell is "not read" and keeps the base
 *   (never `false`); a rule whose precondition fails keeps the base and adds a warning;
 * - base-only keys (topAllowlist, negotiationTypeExclusions, fallbackTableCode, ...) are never written;
 * - `financial.showFinancialArea` (UTILFINANC) is REPORTED only until the financial area exists;
 * - nothing here reads a credential: the facts contain none (the gateway queries never name such columns).
 * The caller validates the result with the contracts schema (which embeds the domain consistency rules).
 */

export class ConfigurationOverlayError extends PermanentJobError {
  constructor(
    readonly code: 'query_not_ok' | 'general_parameters_row',
    message: string,
  ) {
    super(message);
    this.name = 'ConfigurationOverlayError';
  }
}

export interface OverlayEntry {
  readonly key: string;
  readonly previous: unknown;
  readonly next: unknown;
  /** `TABLE.COLUMN` the value was read from. */
  readonly origin: string;
  readonly changed: boolean;
}

export interface OverlayWarning {
  readonly code: string;
  readonly key: string;
  readonly message: string;
}

export interface OverlayInformational {
  /** Q8: distribution of `TGFPRO.AD_MOBILIDADE` (decides nothing today). */
  readonly productMobility: readonly { readonly mobile: boolean | null; readonly count: number }[];
  /** Q1 UTILFINANC: reported, NOT applied to `financial.showFinancialArea` until P6 exists. */
  readonly usesFinancial: boolean | null;
  /** Q1 parameters that have no feature in Sales Force yet (read, reported, not applied). */
  readonly parametersWithoutFeature: Readonly<Record<string, ConfigScalar>>;
}

export interface OverlayResult {
  readonly snapshot: InstallationConfiguration;
  readonly entries: readonly OverlayEntry[];
  readonly warnings: readonly OverlayWarning[];
  readonly informational: OverlayInformational;
}

/** Keys owned by Force only (the base file); listed in the provenance as `{ source: 'base' }` when present. */
const BASE_ONLY_KEYS = [
  'general.appMinimumVersion',
  'sales.topAllowlist',
  'sales.negotiationTypeExclusions',
  'pricing.fallbackTableCode',
] as const;

type Draft = Record<string, unknown>;

function getPath(root: unknown, path: string): unknown {
  let cursor: unknown = root;
  for (const part of path.split('.')) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Draft)[part];
  }
  return cursor;
}

function setPath(root: Draft, path: string, value: unknown): void {
  const parts = path.split('.');
  let cursor = root;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (typeof next !== 'object' || next === null) cursor[part] = {};
    cursor = cursor[part] as Draft;
  }
  cursor[parts[parts.length - 1] as string] = value;
}

function rowsOf<T>(result: ConfigQueryResult<T>, id: string): readonly T[] {
  if (!result.ok) {
    throw new ConfigurationOverlayError('query_not_ok', `Configuration read ${id} failed; nothing was applied.`);
  }
  return result.rows;
}

const sortedUnique = (values: Iterable<number>): number[] => [...new Set(values)].sort((a, b) => a - b);

export function overlayConfigurationFacts(input: {
  readonly base: InstallationConfiguration;
  readonly facts: ConfigurationFacts;
}): OverlayResult {
  const { base, facts } = input;
  const draft = structuredClone(base) as unknown as Draft;
  const entries: OverlayEntry[] = [];
  const warnings: OverlayWarning[] = [];
  const provenance: Record<string, ConfigurationProvenanceEntry> = {};

  const q1Rows = rowsOf(facts.q1GeneralParameters, 'Q1');
  if (q1Rows.length !== 1) {
    throw new ConfigurationOverlayError('general_parameters_row', 'Configuration read Q1 must return exactly one row; nothing was applied.');
  }
  const q1 = q1Rows[0] as (typeof q1Rows)[number];
  const companies = rowsOf(facts.q2Companies, 'Q2');
  const tops = rowsOf(facts.q3EnabledTops, 'Q3');
  const groups = rowsOf(facts.q4TopGroups, 'Q4');
  const negotiation = rowsOf(facts.q5NegotiationTypes, 'Q5');
  const priceTables = rowsOf(facts.q6PriceTables, 'Q6');
  const statuses = rowsOf(facts.q7OrderStatuses, 'Q7');
  const q8 = rowsOf(facts.q8ProductMobility, 'Q8');

  const warn = (code: string, key: string, message: string): void => {
    warnings.push({ code, key, message });
  };

  const fromQuery = (source: ConfigQuerySource, table: string, column: string) => ({
    table,
    column,
    origin: `${table}.${column}`,
    ...(source.filter === undefined ? {} : { filter: source.filter }),
  });
  type Origin = ReturnType<typeof fromQuery>;

  const apply = (key: string, origin: Origin, next: unknown): void => {
    const previous = getPath(draft, key);
    setPath(draft, key, next);
    entries.push({
      key,
      previous: previous === undefined ? null : previous,
      next,
      origin: origin.origin,
      changed: canonicalJson(previous ?? null) !== canonicalJson(next),
    });
    provenance[key] = {
      table: origin.table,
      column: origin.column,
      ...(origin.filter === undefined ? {} : { filter: origin.filter }),
      readAt: facts.readAt,
    };
  };

  const q1Origin = (column: string): Origin => fromQuery(facts.q1GeneralParameters.source, 'AD_TVDYCFGFRC', column);
  const q2Source = facts.q2Companies.source;
  const q3Source = facts.q3EnabledTops.source;

  // ---- companies (Q2) -------------------------------------------------------------------------------------------
  const flagged = companies.filter((company) => company.mobile !== null);
  const enabledCompanies = sortedUnique(companies.filter((c) => c.mobile === true).map((c) => c.companyCode));
  if (flagged.length === 0) {
    warn('companies_not_read', 'general.enabledCompanyCodes', 'TSIEMP.AD_MOBILIDADE is empty for every company; the base list is kept.');
  } else if (enabledCompanies.length === 0) {
    warn('no_company_enabled', 'general.enabledCompanyCodes', 'No company is enabled in Sankhya; the base list is kept.');
  } else {
    apply('general.enabledCompanyCodes', fromQuery(q2Source, 'TSIEMP', 'AD_MOBILIDADE'), enabledCompanies);
    if (enabledCompanies.length === 1) {
      apply('general.defaultCompanyCode', fromQuery(q2Source, 'TSIEMP', 'AD_MOBILIDADE'), enabledCompanies[0]);
    } else {
      warn('several_companies_enabled', 'general.defaultCompanyCode', 'More than one company is enabled in Sankhya; the base default company is kept.');
    }
  }

  // ---- default order TOP (Q2 x Q3) ------------------------------------------------------------------------------
  const defaultCompanyCode = getPath(draft, 'general.defaultCompanyCode');
  const defaultCompany = companies.find((company) => company.companyCode === defaultCompanyCode);
  const enabledTopCodes = new Set(tops.map((top) => top.topCode));
  if (defaultCompany === undefined || defaultCompany.defaultOrderTopCode === null) {
    warn('default_top_not_read', 'sales.orderTopCode', 'The default company has no default TOP in Sankhya; the base order TOP is kept.');
  } else if (!enabledTopCodes.has(defaultCompany.defaultOrderTopCode)) {
    warn('default_top_not_enabled', 'sales.orderTopCode', 'The default TOP of the company is not enabled (AD_MOBILIDADE) in Sankhya; the base order TOP is kept.');
  } else {
    apply('sales.orderTopCode', fromQuery(q2Source, 'TSIEMP', 'AD_CODTIPOPERPAD'), defaultCompany.defaultOrderTopCode);
  }

  // ---- eligible order TOPs (Q3 x allowlist) -------------------------------------------------------------------------
  const orderTops = sortedUnique(tops.filter((top) => top.movementType === 'P').map((top) => top.topCode));
  const allowlist = getPath(draft, 'sales.topAllowlist');
  let eligible = orderTops;
  if (Array.isArray(allowlist)) {
    const allowed = new Set(allowlist as number[]);
    eligible = orderTops.filter((code) => allowed.has(code));
    const notEnabled = sortedUnique((allowlist as number[]).filter((code) => !orderTops.includes(code)));
    if (notEnabled.length > 0) {
      warn('allowlist_top_not_enabled', 'sales.topAllowlist', `TOPs in the allowlist that are not enabled order TOPs in Sankhya were left out: ${notEnabled.join(', ')}.`);
    }
  }
  if (eligible.length === 0) {
    warn('no_eligible_top', 'sales.eligibleOrderTopCodes', 'No enabled order TOP remains after the allowlist; the base list is kept.');
  } else {
    apply('sales.eligibleOrderTopCodes', fromQuery(q3Source, 'TGFTOP', 'AD_MOBILIDADE'), eligible);
  }

  // ---- quotation TOPs (Q4, group ORCAMENTO) -------------------------------------------------------------------
  const quoteTops = sortedUnique(groups.filter((row) => isQuoteGroupName(row.groupName)).map((row) => row.topCode));
  const q4Source = facts.q4TopGroups.source;
  if (quoteTops.length === 0) {
    warn('quote_group_missing', 'sales.quoteTopCodes', 'No Vidya group named ORCAMENTO was found; the base quotation keys are kept.');
  } else {
    const origin = fromQuery(q4Source, 'AD_TVDYGRUOP', 'NOME');
    apply('sales.quoteTopCodes', { ...origin, origin: 'AD_TVDYGRUOP.NOME, AD_TVDYTOPGRU.CODTIPOPER' }, quoteTops);
    if (quoteTops.length === 1) apply('sales.quotationTopCode', origin, quoteTops[0]);
    else warn('several_quote_tops', 'sales.quotationTopCode', 'The ORCAMENTO group has more than one TOP; the base quotation TOP is kept.');
  }

  // ---- skip-confirmation TOPs (Q3) ----------------------------------------------------------------------------
  if (tops.length > 0 && tops.every((top) => top.skipConfirmation === null)) {
    warn('skip_confirmation_not_read', 'sales.skipConfirmationTopCodes', 'TGFTOP.AD_PULARCONFIRMACAO is empty for every enabled TOP; the base value is kept.');
  } else if (tops.length > 0) {
    apply(
      'sales.skipConfirmationTopCodes',
      fromQuery(q3Source, 'TGFTOP', 'AD_PULARCONFIRMACAO'),
      sortedUnique(tops.filter((top) => top.skipConfirmation === true).map((top) => top.topCode)),
    );
  }

  // ---- negotiation types (Q5 minus exclusions) --------------------------------------------------------------
  const exclusions = new Set<number>(
    Array.isArray(getPath(draft, 'sales.negotiationTypeExclusions')) ? (getPath(draft, 'sales.negotiationTypeExclusions') as number[]) : [],
  );
  const baseTypes = new Map(
    ((getPath(draft, 'sales.negotiationTypes') as { code: number; sellable?: boolean }[] | undefined) ?? []).map((type) => [type.code, type]),
  );
  const types = negotiation
    .filter((row) => row.active === true && !exclusions.has(row.code))
    .sort((a, b) => a.code - b.code)
    .map((row) => {
      const label = row.description?.trim();
      if (label === undefined || label === '') {
        warn('negotiation_label_missing', 'sales.negotiationTypes', `Negotiation type ${row.code} has no description in Sankhya; the code is used as label.`);
      }
      const sellable = baseTypes.get(row.code)?.sellable;
      return {
        code: row.code,
        label: label === undefined || label === '' ? String(row.code) : label,
        ...(sellable === undefined ? {} : { sellable }),
      };
    });
  if (types.length === 0) {
    warn('no_negotiation_type', 'sales.negotiationTypes', 'No active negotiation type is enabled in Sankhya; the base list is kept.');
  } else {
    apply('sales.negotiationTypes', fromQuery(facts.q5NegotiationTypes.source, 'TGFTPV', 'AD_MOBILIDADE'), types);
  }

  // ---- general parameters (Q1) --------------------------------------------------------------------------------
  if (q1.orderStockLocationCode !== null) apply('sales.orderStockLocationCode', q1Origin('CODLOCALPEDIDOS'), q1.orderStockLocationCode);
  if (q1.decimalQuantities !== null) apply('sales.orderBehavior.decimalQuantities', q1Origin('USADECQTD'), q1.decimalQuantities);
  if (q1.historyDays !== null) apply('customers.historyDays', q1Origin('DIASCONSULTAVENDAS'), q1.historyDays);
  if (q1.purchasedWindowDays !== null) apply('customers.purchasedWindowDays', q1Origin('QTDDIASPRODCOMPRADOS'), q1.purchasedWindowDays);
  if (q1.hidesCreditLimit !== null) apply('customers.creditFeatures.showCreditLimit', q1Origin('OCLTLIMCRED'), !q1.hidesCreditLimit);
  if (q1.catalogReferenceTableCode !== null) apply('pricing.catalogReferenceTableCode', q1Origin('TABPADCSLTPROD'), q1.catalogReferenceTableCode);
  if (q1.alternativeTableCode !== null) {
    const existing = getPath(draft, 'pricing.alternativeTable');
    if (typeof existing !== 'object' || existing === null) {
      // The base has none: the table is recorded as an unvalidated, INACTIVE alternative (never a fallback).
      setPath(draft, 'pricing.alternativeTable', { tableCode: q1.alternativeTableCode, validation: 'needs_validation', active: false });
      entries.push({ key: 'pricing.alternativeTable.tableCode', previous: null, next: q1.alternativeTableCode, origin: 'AD_TVDYCFGFRC.CODTABALT', changed: true });
      provenance['pricing.alternativeTable.tableCode'] = {
        table: 'AD_TVDYCFGFRC',
        column: 'CODTABALT',
        ...(facts.q1GeneralParameters.source.filter === undefined ? {} : { filter: facts.q1GeneralParameters.source.filter }),
        readAt: facts.readAt,
      };
    } else {
      apply('pricing.alternativeTable.tableCode', q1Origin('CODTABALT'), q1.alternativeTableCode);
    }
  }

  // ---- price tables (Q6) ---------------------------------------------------------------------------------------
  const mobileTables = sortedUnique(priceTables.filter((table) => table.mobile === true).map((table) => table.tableCode));
  if (mobileTables.length === 0) {
    warn('no_mobile_price_table', 'pricing.mobilePriceTableCodes', 'No price table is enabled (AD_MOBILIDADE) in Sankhya; the base list is kept.');
  } else {
    apply('pricing.mobilePriceTableCodes', fromQuery(facts.q6PriceTables.source, 'TGFNTA', 'AD_MOBILIDADE'), mobileTables);
  }

  // ---- order status presentation (Q7) --------------------------------------------------------------------------
  const display: OrderStatusDisplay[] = [];
  for (const status of statuses) {
    const label = (status.name ?? status.description)?.trim();
    const color = status.color?.trim();
    if (
      label === undefined || label === '' || color === undefined || color === '' ||
      status.canEdit === null || status.canDuplicate === null || status.canDelete === null
    ) {
      warn('status_incomplete', 'erp.orderStatusDisplay', `Order status ${status.code} is incomplete in Sankhya (name, colour or permission empty) and was left out.`);
      continue;
    }
    display.push({
      code: String(status.code),
      label,
      color: color.startsWith('#') ? color : `#${color}`,
      canEdit: status.canEdit,
      canDuplicate: status.canDuplicate,
      canDelete: status.canDelete,
    });
  }
  if (display.length === 0) {
    warn('no_order_status', 'erp.orderStatusDisplay', 'No usable order status was read; the base value is kept.');
  } else {
    apply('erp.orderStatusDisplay', fromQuery(facts.q7OrderStatuses.source, 'AD_TVDYFRCSTS', 'NOME'), display);
  }

  // ---- provenance of what was NOT read: the base file --------------------------------------------------------
  const bridgeKeys = [
    'general.enabledCompanyCodes',
    'general.defaultCompanyCode',
    'sales.orderTopCode',
    'sales.eligibleOrderTopCodes',
    'sales.quoteTopCodes',
    'sales.quotationTopCode',
    'sales.skipConfirmationTopCodes',
    'sales.negotiationTypes',
    'sales.orderStockLocationCode',
    'sales.orderBehavior.decimalQuantities',
    'pricing.mobilePriceTableCodes',
    'pricing.catalogReferenceTableCode',
    'pricing.alternativeTable.tableCode',
    'customers.historyDays',
    'customers.purchasedWindowDays',
    'customers.creditFeatures.showCreditLimit',
    'erp.orderStatusDisplay',
  ];
  for (const key of [...bridgeKeys, ...BASE_ONLY_KEYS]) {
    if (provenance[key] === undefined && getPath(draft, key) !== undefined && getPath(draft, key) !== null) {
      provenance[key] = { source: 'base' };
    }
  }

  const parametersWithoutFeature: Record<string, ConfigScalar> = {};
  for (const [column, value] of Object.entries(q1.informational)) if (value !== null) parametersWithoutFeature[column] = value;

  draft['provenance'] = provenance;
  // The label is deterministic for a given base (it is part of the content hash); `syncedAt` is ignored by the hash.
  draft['source'] = {
    kind: 'sankhya',
    version: `sankhya-overlay:${base.source.version}`,
    syncedAt: facts.readAt,
    base: { kind: 'bootstrap-file', version: base.source.version },
  };
  return {
    snapshot: draft as unknown as InstallationConfiguration,
    entries,
    warnings,
    informational: {
      productMobility: q8.map((row) => ({ mobile: row.mobile, count: row.count })),
      usesFinancial: q1.usesFinancial,
      parametersWithoutFeature,
    },
  };
}
