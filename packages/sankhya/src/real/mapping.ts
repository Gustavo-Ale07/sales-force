import type {
  Customer,
  DecimalString,
  DirectoryUser,
  Carrier,
  IpiRate,
  IsoTimestamp,
  OpenTitle,
  ListPrice,
  PriceTable,
  PriceTableVersion,
  Product,
  ProductGroup,
  Seller,
} from '@salesforce/domain';
import { decimalFromCell } from '../decimal.js';
import { SankhyaGatewayError } from '../errors.js';
import type { ReadEntity } from '../gateway.js';
import { MEDIA_SAMPLE_BYTES, MEDIA_SAMPLE_PERCENTS } from '../media.js';
import { assertSafeScope, customerExclusion, type ReadScope } from '../read-scope.js';

/**
 * ERP row -> Sales Force type mapping. This is the ONLY place in the repository that names ERP tables
 * and columns (P-02, P-03). Every column below is VALIDATED in `docs/sankhya-spike.md` (§9.30, §9.35,
 * F-24...F-27, F-38) except where a comment says NEEDS VALIDATION.
 *
 * Fail closed: a row that does not match the expected shape aborts the snapshot with a `validation`
 * error naming the entity and column, never the value (values can be personal data).
 */

export interface MapContext {
  /** DB clock offset from UTC in minutes (Sandbox: -180, F-39; production NEEDS VALIDATION). */
  readonly dbUtcOffsetMinutes: number;
}

export interface EntitySpec<T> {
  readonly entity: ReadEntity;
  readonly table: string;
  /** SQL select expressions; each is aliased so the response column names are exactly `columns`. */
  readonly select: readonly string[];
  readonly columns: readonly string[];
  readonly where?: string;
  /** Full primary key, so paging is deterministic (F-23, F-30). */
  readonly orderBy: string;
  /**
   * Maps one row. A row that is bad on its own (not the page, not the contract) is discarded with `discardRow(..)`: the read
   * continues, the row still counts for the completeness check and the reason reaches `ReadOptions.onWarning`.
   */
  readonly map: (row: RowReader, context: MapContext) => T | RowDiscard;
  /** Strictly increasing key of a mapped row; used to detect duplicates and mis-ordering. */
  readonly keyOf: (row: T) => readonly number[];
}

/** A row a mapper chose to drop (see `EntitySpec.map`); `reason` never carries a value. */
export interface RowDiscard {
  readonly discarded: string;
  /** Expected exclusions (an eligibility rule) are counted by the caller, not warned about row by row. */
  readonly silent?: boolean;
}

export function discardRow(reason: string, silent = false): RowDiscard {
  return silent ? { discarded: reason, silent } : { discarded: reason };
}

export function isRowDiscard(value: unknown): value is RowDiscard {
  return typeof value === 'object' && value !== null && typeof (value as { discarded?: unknown }).discarded === 'string';
}

export class RowReader {
  readonly #entity: ReadEntity | 'orders';
  readonly #columns: readonly string[];
  readonly #cells: readonly unknown[];
  readonly #index: number;

  constructor(entity: ReadEntity | 'orders', columns: readonly string[], cells: readonly unknown[], index: number) {
    this.#entity = entity;
    this.#columns = columns;
    this.#cells = cells;
    this.#index = index;
  }

  #fail(column: string, problem: string): never {
    throw new SankhyaGatewayError('validation', {
      code: 'invalid_row',
      message: `${this.#entity}: column ${column} ${problem} (row ${this.#index} of the page). The ERP data does not match the validated contract; the snapshot was rejected.`,
    });
  }

  /** Rejects the snapshot for a business-level anomaly a mapper detected (never echoes the value). */
  reject(column: string, problem: string): never {
    return this.#fail(column, problem);
  }

  #cell(column: string): unknown {
    const position = this.#columns.indexOf(column);
    if (position < 0) this.#fail(column, 'is not part of the query');
    return this.#cells[position];
  }

  int(column: string): number {
    const value = this.nullableInt(column);
    if (value === null) this.#fail(column, 'is null');
    return value;
  }

  nullableInt(column: string): number | null {
    const cell = this.#cell(column);
    if (cell === null || cell === undefined || cell === '') return null;
    if (typeof cell === 'number' && Number.isSafeInteger(cell)) return cell;
    if (typeof cell === 'string' && /^-?\d{1,15}$/.test(cell.trim())) return Number(cell.trim());
    return this.#fail(column, 'is not an integer');
  }

  /** Integer, or `null` when the cell is null OR not an integer (never fails): for a key the caller may discard the row by. */
  integerOrNull(column: string): number | null {
    const cell = this.#cell(column);
    if (typeof cell === 'number' && Number.isSafeInteger(cell)) return cell;
    if (typeof cell === 'string' && /^-?\d{1,15}$/.test(cell.trim())) return Number(cell.trim());
    return null;
  }

  nullableText(column: string): string | null {
    const cell = this.#cell(column);
    if (cell === null || cell === undefined) return null;
    if (typeof cell !== 'string') return this.#fail(column, 'is not text');
    const trimmed = cell.trim();
    return trimmed === '' ? null : trimmed;
  }

  /** Untyped scalar for report-only columns whose type is not validated; never interpreted. */
  rawScalar(column: string): string | number | null {
    const cell = this.#cell(column);
    if (cell === null || cell === undefined || cell === '') return null;
    if (typeof cell === 'string') return cell.trim() === '' ? null : cell;
    if (typeof cell === 'number' && Number.isFinite(cell)) return cell;
    return this.#fail(column, 'is not a scalar value');
  }

  /** `S`/`N` flag where null stays `null` ("not read"), never `false`. Anything else is rejected. */
  nullableFlag(column: string): boolean | null {
    const cell = this.#cell(column);
    if (cell === null || cell === undefined || cell === '') return null;
    if (cell === 'S') return true;
    if (cell === 'N') return false;
    return this.#fail(column, 'is not S or N');
  }

  /** Lenient S/N flag for presentation-only columns: `invalid` when the cell is neither null, S nor N (never fails the row). */
  flagOrInvalid(column: string): { readonly value: boolean | null; readonly invalid: boolean } {
    const cell = this.#cell(column);
    if (cell === null || cell === undefined || cell === '') return { value: null, invalid: false };
    if (cell === 'S') return { value: true, invalid: false };
    if (cell === 'N') return { value: false, invalid: false };
    return { value: null, invalid: true };
  }

  text(column: string): string {
    const value = this.nullableText(column);
    if (value === null) this.#fail(column, 'is null or blank');
    return value;
  }

  /** `S`/`N` flag. `null` handling is the caller's decision (`nullAs`); anything else is rejected. */
  flag(column: string, nullAs?: boolean): boolean {
    const cell = this.#cell(column);
    if (cell === null || cell === undefined || cell === '') {
      if (nullAs !== undefined) return nullAs;
      return this.#fail(column, 'is null');
    }
    if (cell === 'S') return true;
    if (cell === 'N') return false;
    return this.#fail(column, 'is not S or N');
  }

  nullableDecimal(column: string): DecimalString | null {
    const cell = this.#cell(column);
    if (cell === null || cell === undefined || cell === '') return null;
    const parsed = decimalFromCell(cell);
    if (!parsed.ok) return this.#fail(column, `is not an unsigned decimal within range (${parsed.problem})`);
    return parsed.value;
  }

  decimal(column: string): DecimalString {
    const value = this.nullableDecimal(column);
    if (value === null) this.#fail(column, 'is null');
    return value;
  }

  /** `YYYY-MM-DD` (produced by `TO_CHAR` in the query) as the start of that day in the DB clock zone, in UTC. */
  dateAsInstant(column: string, dbUtcOffsetMinutes: number): IsoTimestamp {
    const value = this.text(column);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return this.#fail(column, 'is not a YYYY-MM-DD date');
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const midnight = Date.UTC(year, month - 1, day);
    const date = new Date(midnight);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      return this.#fail(column, 'is not a valid calendar date');
    }
    return new Date(midnight - dbUtcOffsetMinutes * 60_000).toISOString();
  }

  /** `YYYY-MM-DD` business date (produced by TO_CHAR in the query), validated as a real calendar date and returned as is. */
  businessDate(column: string): string {
    const value = this.text(column);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return this.#fail(column, 'is not a YYYY-MM-DD date');
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      return this.#fail(column, 'is not a valid calendar date');
    }
    return value;
  }

  /** Column must be null/blank or one of the given values; used to fail closed on unmodelled variants. */
  expectBlankOrZero(column: string): void {
    const cell = this.#cell(column);
    if (cell === null || cell === undefined || cell === '' || cell === 0 || cell === '0') return;
    if (typeof cell === 'string' && cell.trim() === '') return;
    this.#fail(column, 'has a value the mirror cannot model');
  }
}

/** TGFVEN (§9.30 F-25, §9.35). PK CODVEND. */
export const SELLER_SPEC: EntitySpec<Seller> = {
  entity: 'sellers',
  table: 'TGFVEN',
  select: ['CODVEND', 'APELIDO', 'ATIVO'],
  columns: ['CODVEND', 'APELIDO', 'ATIVO'],
  orderBy: 'CODVEND',
  map: (row) => ({ code: row.int('CODVEND'), name: row.text('APELIDO'), active: row.flag('ATIVO') }),
  keyOf: (seller) => [seller.code],
};

/**
 * TSIUSU (§9.30; spike F-33/F-34: `CODVEND -> TGFVEN.CODVEND` FK, at most one seller per user). PK CODUSU. ONLY the user code
 * and its seller code are read: no name, e-mail, password/hash, session or permission column ever enters the query.
 * `CODVEND` 0/null = the user has no seller. Whether a user can be deactivated/blocked and which column says so is NEEDS
 * VALIDATION (probe `.claude/work/sankhya-user-probe.mjs`); until then deactivation is detected only through the user row
 * disappearing or its seller changing/becoming inactive.
 */
export const DIRECTORY_USER_SPEC: EntitySpec<DirectoryUser> = {
  entity: 'directoryUsers',
  table: 'TSIUSU',
  select: ['CODUSU', 'CODVEND'],
  columns: ['CODUSU', 'CODVEND'],
  where: 'CODUSU > 0',
  orderBy: 'CODUSU',
  map: (row) => {
    const sellerCode = row.nullableInt('CODVEND');
    return { code: row.int('CODUSU'), sellerCode: sellerCode === null || sellerCode <= 0 ? null : sellerCode };
  },
  keyOf: (user) => [user.code],
};

/**
 * TGFPAR partners flagged as carriers (decisions D-C / P3: 52 active in the Sandbox). PK CODPARC. Only code, name and the
 * active flag are read: no document number. The filtered paged read was not measured on its own (NEEDS VALIDATION, as for customers).
 */
export const CARRIER_SPEC: EntitySpec<Carrier> = {
  entity: 'carriers',
  table: 'TGFPAR',
  select: ['CODPARC', 'NOMEPARC', 'RAZAOSOCIAL', 'ATIVO'],
  columns: ['CODPARC', 'NOMEPARC', 'RAZAOSOCIAL', 'ATIVO'],
  // D-V: carriers are partners flagged TRANSPORTADORA = 'S' that are active (ATIVO = 'S').
  where: "TRANSPORTADORA = 'S' AND ATIVO = 'S' AND CODPARC > 0",
  orderBy: 'CODPARC',
  map: (row) => ({
    code: row.int('CODPARC'),
    name: row.nullableText('RAZAOSOCIAL') ?? row.text('NOMEPARC'),
    active: row.flag('ATIVO'),
  }),
  keyOf: (carrier) => [carrier.code],
};

/**
 * TGFPAR (§9.30 F-24, §9.35). PK CODPARC. Only rows flagged `CLIENTE = 'S'` (a filtered paged read is
 * a WHERE on top of the measured ORDER BY + OFFSET/FETCH; it was not measured on its own - NEEDS
 * VALIDATION, spike §9.42 note). `CODVEND`/`CODTAB` pass through as recorded (0 is not converted to
 * "none": whether 0 means no seller is a business rule). `BLOQUEAR` semantics were not measured: only
 * `S`/`N`/null are accepted, null = not blocked (NEEDS VALIDATION S4).
 */
export const CUSTOMER_SPEC: EntitySpec<Customer> = {
  entity: 'customers',
  table: 'TGFPAR',
  select: ['CODPARC', 'NOMEPARC', 'RAZAOSOCIAL', 'CGC_CPF', 'ATIVO', 'BLOQUEAR', 'CODVEND', 'CODTAB', 'LIMCRED', 'LIMCREDMENSAL', 'MOTBLOQ', 'SITUACAO'],
  columns: ['CODPARC', 'NOMEPARC', 'RAZAOSOCIAL', 'CGC_CPF', 'ATIVO', 'BLOQUEAR', 'CODVEND', 'CODTAB', 'LIMCRED', 'LIMCREDMENSAL', 'MOTBLOQ', 'SITUACAO'],
  // `CODPARC = 0` is the ERP placeholder row (flagged CLIENTE = 'S' in the Sandbox, 2026-09-30): never mirrored.
  where: "CLIENTE = 'S' AND CODPARC > 0",
  orderBy: 'CODPARC',
  map: (row) => {
    const tradeName = row.nullableText('NOMEPARC');
    const legalName = row.nullableText('RAZAOSOCIAL');
    const name = legalName ?? tradeName ?? row.text('NOMEPARC');
    return {
      code: row.int('CODPARC'),
      name,
      tradeName,
      document: row.nullableText('CGC_CPF'),
      active: row.flag('ATIVO'),
      blocked: row.flag('BLOQUEAR', false),
      sellerCode: row.nullableInt('CODVEND'),
      priceTableCode: row.nullableInt('CODTAB'),
      creditLimit: row.nullableDecimal('LIMCRED'),
      monthlyCreditLimit: row.nullableDecimal('LIMCREDMENSAL'),
      blockReason: row.nullableText('MOTBLOQ'),
      situation: row.nullableText('SITUACAO'),
    };
  },
  keyOf: (customer) => [customer.code],
};

/**
 * D-V: the customer spec under an eligibility rule. The source is read for every partner (`CODPARC > 0`) and the rule
 * is applied row by row so each criterion can be counted (`tally`); a left-out partner is discarded like any dropped
 * row (it still counts for the completeness check and is deactivated in the mirror by the missing-row rule, while
 * saved orders keep it). The rule columns are selected on top of the base ones; the gateway has already checked that
 * they exist in this ERP schema.
 */
export function customerSpec(scope: ReadScope | undefined, tally?: Record<string, number>): EntitySpec<Customer> {
  assertSafeScope(scope);
  const rules = scope?.customers;
  if (rules === undefined) return CUSTOMER_SPEC;
  const extra = [...new Set([...rules.requiredFlags, ...rules.columnIn.map((r) => r.column)])].filter(
    (c) => !CUSTOMER_SPEC.columns.includes(c),
  );
  const columns = [...CUSTOMER_SPEC.columns, ...extra];
  return {
    ...CUSTOMER_SPEC,
    select: [...CUSTOMER_SPEC.select, ...extra],
    columns,
    where: "CODPARC > 0",
    map: (row, context) => {
      const exclusion = customerExclusion(row.flag("ATIVO"), (column) => row.nullableText(column), rules);
      if (exclusion !== null) {
        if (tally !== undefined) tally[exclusion] = (tally[exclusion] ?? 0) + 1;
        return discardRow(`left out by eligibility (${exclusion})`, true);
      }
      return CUSTOMER_SPEC.map(row, context);
    },
  };
}

/**
 * TGFFIN open receivable titles (Sandbox 2026-11-03, per the Vidya financial views): `RECDESP = 1` (receivable),
 * `PROVISAO = 'N'` (not a provision), open = `DHBAIXA` null. PK NUFIN. Read in full on every run (complete snapshot, so a settled
 * title disappears from the mirror); no incremental column is used (YAGNI). `VLRDESDOB` is the title value, `VLRBAIXA` what was
 * already settled. Read-only information: it never blocks a sale (D-I).
 */
export const OPEN_TITLE_SPEC: EntitySpec<OpenTitle> = {
  entity: 'openTitles',
  table: 'TGFFIN',
  select: ['NUFIN', 'NUNOTA', 'CODPARC', 'CODEMP', "TO_CHAR(DTVENC, 'YYYY-MM-DD') AS DTVENC", 'VLRDESDOB', 'VLRBAIXA'],
  columns: ['NUFIN', 'NUNOTA', 'CODPARC', 'CODEMP', 'DTVENC', 'VLRDESDOB', 'VLRBAIXA'],
  where: "RECDESP = 1 AND PROVISAO = 'N' AND DHBAIXA IS NULL AND CODPARC > 0",
  orderBy: 'NUFIN',
  map: (row) => {
    // A title without a due date or a value cannot be aged or summed: dropped with a warning, the rest of the page stays.
    if (row.nullableText('DTVENC') === null) return discardRow('DTVENC is null');
    const amount = row.nullableDecimal('VLRDESDOB');
    if (amount === null) return discardRow('VLRDESDOB is null');
    return {
      nufin: row.int('NUFIN'),
      customerCode: row.int('CODPARC'),
      companyCode: row.nullableInt('CODEMP'),
      documentNumber: row.nullableInt('NUNOTA'),
      dueDate: row.businessDate('DTVENC'),
      amount,
      paidAmount: row.nullableDecimal('VLRBAIXA') ?? '0',
    };
  },
  keyOf: (title) => [title.nufin],
};

/**
 * TGFPRO (§9.30 F-26, §9.35). PK CODPROD. `CODVOL` is the unit of measure. `USOPROD` is mirrored raw;
 * whether it makes the product sellable is configuration only (CFG-1..6).
 */
export const PRODUCT_SPEC: EntitySpec<Product> = {
  entity: 'products',
  table: 'TGFPRO',
  select: ['CODPROD', 'DESCRPROD', 'ATIVO', 'USOPROD', 'CODGRUPOPROD', 'CODVOL', 'MARCA', 'REFERENCIA', 'CODIPI'],
  columns: ['CODPROD', 'DESCRPROD', 'ATIVO', 'USOPROD', 'CODGRUPOPROD', 'CODVOL', 'MARCA', 'REFERENCIA', 'CODIPI'],
  // `CODPROD = 0` is the ERP placeholder row ("<sem descrição>", Sandbox 2026-09-30): never mirrored.
  where: 'CODPROD > 0',
  orderBy: 'CODPROD',
  map: (row) => ({
    code: row.int('CODPROD'),
    description: row.text('DESCRPROD'),
    active: row.flag('ATIVO'),
    usageCode: row.nullableText('USOPROD'),
    groupCode: row.nullableInt('CODGRUPOPROD'),
    unit: row.text('CODVOL'),
    brand: row.nullableText('MARCA'),
    reference: row.nullableText('REFERENCIA'),
    ipiCode: row.nullableInt('CODIPI'),
  }),
  keyOf: (product) => [product.code],
};

/**
 * TGFIPI (Sandbox 2026-11-03: CODIPI 5 = 3.25, CODIPI 6 = 9.75; both VLRPAUTA 0, PAUTACONDIC 'N'). PK CODIPI. Read in full on
 * every run (a handful of rows). `PERCENTUAL` is the rate in percent. VLRPAUTA > 0 or PAUTACONDIC = 'S' means IPI by tariff
 * value (pauta), which the Sales Force does not estimate (D-D).
 */
export const IPI_RATE_SPEC: EntitySpec<IpiRate> = {
  entity: 'ipiRates',
  table: 'TGFIPI',
  select: ['CODIPI', 'DESCRICAO', 'PERCENTUAL', 'VLRPAUTA', 'PAUTACONDIC', 'CSTIPISAI'],
  columns: ['CODIPI', 'DESCRICAO', 'PERCENTUAL', 'VLRPAUTA', 'PAUTACONDIC', 'CSTIPISAI'],
  orderBy: 'CODIPI',
  map: (row) => {
    // A row without a usable key is dropped (the page and the other rates stay); nothing can reference it.
    const code = row.integerOrNull('CODIPI');
    if (code === null) return discardRow('CODIPI is null or not an integer');
    const tariffValue = row.nullableDecimal('VLRPAUTA');
    // A code without a rate (exempt / not taxed) is a valid TGFIPI row: rate 0.00 flagged `rateMissing` (never read as a real 0%).
    const percentual = row.nullableDecimal('PERCENTUAL');
    return {
      code,
      description: row.nullableText('DESCRICAO') ?? '',
      percentual: percentual ?? '0.00',
      rateMissing: percentual === null,
      byTariff: (tariffValue !== null && Number(tariffValue) > 0) || row.nullableText('PAUTACONDIC') === 'S',
    };
  },
  keyOf: (rate) => [rate.code],
};

/** `TGFGRU.CODGRUPAI` of a root group (validated on the ERP test base): a sentinel, not a parent code. */
const ROOT_GROUP_PARENT = -999_999_999;

/**
 * TGFGRU (validated on the ERP test base: data dictionary + sample). PK CODGRUPOPROD. `CODGRUPOPROD = 0`
 * is the "<SEM GRUPO>" placeholder and is never mirrored. `CODGRUPAI = -999999999` marks a root group
 * (parent `null`). The group image column is never selected.
 */
export const PRODUCT_GROUP_SPEC: EntitySpec<ProductGroup> = {
  entity: 'productGroups',
  table: 'TGFGRU',
  select: ['CODGRUPOPROD', 'DESCRGRUPOPROD', 'CODGRUPAI', 'GRAU', 'ANALITICO', 'ATIVO'],
  columns: ['CODGRUPOPROD', 'DESCRGRUPOPROD', 'CODGRUPAI', 'GRAU', 'ANALITICO', 'ATIVO'],
  where: 'CODGRUPOPROD > 0',
  orderBy: 'CODGRUPOPROD',
  map: (row) => {
    const parent = row.nullableInt('CODGRUPAI');
    // Group 0 is the "<SEM GRUPO>" placeholder and is never mirrored, so nothing may hang below it. A
    // real group pointing at 0 is a data anomaly (the validated root marker is the sentinel): reject
    // instead of creating a reference to a group that does not exist.
    if (parent === 0) row.reject('CODGRUPAI', 'points to the placeholder group 0 as its parent (data anomaly)');
    return {
      code: row.int('CODGRUPOPROD'),
      name: row.text('DESCRGRUPOPROD'),
      parentCode: parent === null || parent === ROOT_GROUP_PARENT ? null : parent,
      degree: row.int('GRAU'),
      analytic: row.flag('ANALITICO'),
      active: row.flag('ATIVO'),
    };
  },
  keyOf: (group) => [group.code],
};

function withWhere(clause: string | undefined): { where?: string } {
  return clause === undefined ? {} : { where: clause };
}

/** `<column> IN (..)` from the configured codes; `undefined` = no scope. Codes were validated as integers. */
function tableCodeClause(column: string, scope: ReadScope | undefined): string | undefined {
  const codes = scope?.priceTableCodes;
  if (codes === undefined) return undefined;
  // An empty list never reaches the ERP (the gateway short-circuits); `IN ()` is invalid SQL.
  return `${column} IN (${codes.join(',')})`;
}

/**
 * TGFNTA (validated: CODTAB, NOMETAB, ATIVO). PK CODTAB; table 0 is a valid table (proven fallback).
 * Which tables are mirrored is decided by the installation configuration (`scope.priceTableCodes`),
 * never here. Derived-table fields (`CODTABORIG`/`PERCENTUAL`) live per version (F-41) and are not read.
 */
export function priceTableSpec(scope: ReadScope | undefined): EntitySpec<PriceTable> {
  return {
    entity: 'priceTables',
    table: 'TGFNTA',
    select: ['CODTAB', 'NOMETAB', 'ATIVO'],
    columns: ['CODTAB', 'NOMETAB', 'ATIVO'],
    ...withWhere(tableCodeClause('CODTAB', scope)),
    orderBy: 'CODTAB',
    map: (row) => ({
      code: row.int('CODTAB'),
      name: row.text('NOMETAB'),
      active: row.flag('ATIVO'),
      originTableCode: null,
      percent: null,
    }),
    keyOf: (table) => [table.code],
  };
}

/** TGFPRO restricted by the installation configuration (see `ReadScope.products`). */
export function productSpec(scope: ReadScope | undefined): EntitySpec<Product> {
  const filter = scope?.products;
  if (filter === undefined) return PRODUCT_SPEC;
  assertSafeScope(scope); // values reach SQL text: never rely on the caller having asserted
  const terms = ['CODPROD > 0'];
  if (filter.activeOnly !== false) terms.push("ATIVO = 'S'");
  terms.push(`USOPROD IN (${filter.usageValues.map((v) => `'${v}'`).join(',')})`);
  const mobilityField = filter.mobilitySourceField ?? null;
  if (mobilityField !== null && filter.mobilityAllowedValues !== undefined && filter.mobilityAllowedValues.length > 0) {
    terms.push(`${mobilityField} IN (${filter.mobilityAllowedValues.map((v) => `'${v}'`).join(',')})`);
  }
  const columns = mobilityField === null ? PRODUCT_SPEC.columns : [...PRODUCT_SPEC.columns, 'MOBILITY'];
  const select = mobilityField === null ? PRODUCT_SPEC.select : [...PRODUCT_SPEC.select, `${mobilityField} AS MOBILITY`];
  return {
    ...PRODUCT_SPEC,
    select,
    columns,
    where: terms.join(' AND '),
    map: (row, context) => {
      const product = PRODUCT_SPEC.map(row, context);
      return mobilityField === null ? product : { ...product, mobilityCode: row.nullableText('MOBILITY') };
    },
  };
}

/**
 * TGFTAB (F-38, F-39). PK NUTAB. `DTVIGOR` is read as `TO_CHAR(..., 'YYYY-MM-DD')` (Oracle dialect,
 * F-19) and interpreted as the start of that day in the DB clock zone; time-of-day and the behavior
 * at the exact vigencia instant are NEEDS VALIDATION (F-39). `CODTABORIG` / `PERCENTUAL` (derived
 * tables, F-41) are not read: the domain models them per table, the ERP keeps them per version, and
 * the derivation rule is NEEDS VALIDATION (S2.3).
 */
export const PRICE_TABLE_VERSION_SPEC: EntitySpec<PriceTableVersion> = {
  entity: 'priceTableVersions',
  table: 'TGFTAB',
  select: ['NUTAB', 'CODTAB', "TO_CHAR(DTVIGOR, 'YYYY-MM-DD') AS DTVIGOR"],
  columns: ['NUTAB', 'CODTAB', 'DTVIGOR'],
  orderBy: 'NUTAB',
  map: (row, context) => ({
    versionId: row.int('NUTAB'),
    tableCode: row.int('CODTAB'),
    effectiveFrom: row.dateAsInstant('DTVIGOR', context.dbUtcOffsetMinutes),
  }),
  keyOf: (version) => [version.versionId],
};

/** Versions of the configured tables only (all of them; the gateway then keeps the effective ones). */
export function priceTableVersionSpec(scope: ReadScope | undefined): EntitySpec<PriceTableVersion> {
  return { ...PRICE_TABLE_VERSION_SPEC, ...withWhere(tableCodeClause('CODTAB', scope)) };
}

/**
 * TGFEXC (F-27, F-38, F-42). Full PK is (NUTAB, CODPROD, CODLOCAL, CONTROLE). The mirror keys rows by
 * (version, product); `CODLOCAL` and `CONTROLE` were 0 / blank on every Sandbox row, so any other
 * value aborts the snapshot instead of being collapsed. Only rows that exist are returned: absence
 * is "no price", an explicit 0 row stays "0" (F-42). A null price is rejected (never observed; not
 * silently read as "no price" or as 0).
 */
export const LIST_PRICE_SPEC: EntitySpec<ListPrice> = {
  entity: 'listPrices',
  table: 'TGFEXC',
  select: ['NUTAB', 'CODPROD', 'CODLOCAL', 'CONTROLE', 'VLRVENDA'],
  columns: ['NUTAB', 'CODPROD', 'CODLOCAL', 'CONTROLE', 'VLRVENDA'],
  orderBy: 'NUTAB, CODPROD, CODLOCAL, CONTROLE',
  map: (row) => {
    row.expectBlankOrZero('CODLOCAL');
    row.expectBlankOrZero('CONTROLE');
    return { versionId: row.int('NUTAB'), productCode: row.int('CODPROD'), unitPrice: row.decimal('VLRVENDA') };
  },
  keyOf: (price) => [price.versionId, price.productCode],
};

/** Prices of the given versions only (ids the gateway itself read; never empty). */
export function listPriceSpec(versionIds: readonly number[] | undefined): EntitySpec<ListPrice> {
  if (versionIds === undefined) return LIST_PRICE_SPEC;
  // CODPROD = 0 is the ERP placeholder row: never mirrored.
  return { ...LIST_PRICE_SPEC, where: `NUTAB IN (${versionIds.join(',')}) AND CODPROD > 0` };
}

export function compareKeys(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

// ---- product photo (TGFPRO.IMAGEM) transport (spike F-54, F-55) ------------------------------------
// The BLOB is never part of PRODUCT_SPEC / productSpec: it is read only by the statements below, in
// 2000-byte hex chunks (the SQL RAW limit), through the same `DbExplorerSP.executeQuery` flow.

const MEDIA_LEN = 'DBMS_LOB.GETLENGTH(IMAGEM)';
export const PRODUCT_MEDIA_SIGNATURE_COLUMNS: readonly string[] = ['CODPROD', 'LEN', 'W0', 'W1', 'W2', 'W3', 'W4'];
export const PRODUCT_MEDIA_CHUNK_COLUMNS: readonly string[] = ['H'];
export const PRODUCT_MEDIA_LENGTH_COLUMNS: readonly string[] = ['LEN'];

/**
 * One batched, keyset-paged statement: same product WHERE as `productSpec(scope)`, plus the length and
 * five sampled 32-byte windows per row (offsets mirror `mediaSampleOffsets`). Only integers we validated
 * are interpolated. Never selects the BLOB itself.
 */
export function productMediaSignaturesSql(scope: ReadScope | undefined, afterCode: number, limit: number): string {
  const where = productSpec(scope).where ?? 'CODPROD > 0';
  const window = (offset: string) => `RAWTOHEX(DBMS_LOB.SUBSTR(IMAGEM, ${MEDIA_SAMPLE_BYTES}, ${offset}))`;
  const offsets = [
    '1',
    ...MEDIA_SAMPLE_PERCENTS.map((p) => `GREATEST(1, TRUNC(${MEDIA_LEN} * ${p} / 100))`),
    `GREATEST(1, ${MEDIA_LEN} - ${MEDIA_SAMPLE_BYTES - 1})`,
  ];
  const windows = offsets.map((offset, i) => `${window(offset)} AS W${i}`);
  return (
    `SELECT CODPROD, ${MEDIA_LEN} AS LEN, ${windows.join(', ')} FROM TGFPRO` +
    ` WHERE ${where} AND CODPROD > ${afterCode} AND IMAGEM IS NOT NULL AND ${MEDIA_LEN} > 0` +
    ` ORDER BY CODPROD FETCH FIRST ${limit} ROWS ONLY`
  );
}

/** The proven chunk statement (F-54): `offset` is 1-based, `bytes` <= 2000. */
export function productMediaChunkSql(productCode: number, offset: number, bytes: number): string {
  return `SELECT RAWTOHEX(DBMS_LOB.SUBSTR(IMAGEM, ${bytes}, ${offset})) AS H FROM TGFPRO WHERE CODPROD = ${productCode}`;
}

/** Final length re-check after assembling the chunks (detects an image replaced while reading). */
export function productMediaLengthSql(productCode: number): string {
  return `SELECT ${MEDIA_LEN} AS LEN FROM TGFPRO WHERE CODPROD = ${productCode}`;
}
