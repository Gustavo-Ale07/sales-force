import type {
  Customer,
  DecimalString,
  IsoTimestamp,
  ListPrice,
  PriceTableVersion,
  Product,
  Seller,
} from '@salesforce/domain';
import { decimalFromCell } from '../decimal.js';
import { SankhyaGatewayError } from '../errors.js';
import type { ReadEntity } from '../gateway.js';

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
  readonly map: (row: RowReader, context: MapContext) => T;
  /** Strictly increasing key of a mapped row; used to detect duplicates and mis-ordering. */
  readonly keyOf: (row: T) => readonly number[];
}

export class RowReader {
  readonly #entity: ReadEntity;
  readonly #columns: readonly string[];
  readonly #cells: readonly unknown[];
  readonly #index: number;

  constructor(entity: ReadEntity, columns: readonly string[], cells: readonly unknown[], index: number) {
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

  nullableText(column: string): string | null {
    const cell = this.#cell(column);
    if (cell === null || cell === undefined) return null;
    if (typeof cell !== 'string') return this.#fail(column, 'is not text');
    const trimmed = cell.trim();
    return trimmed === '' ? null : trimmed;
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
 * TGFPAR (§9.30 F-24, §9.35). PK CODPARC. Only rows flagged `CLIENTE = 'S'` (a filtered paged read is
 * a WHERE on top of the measured ORDER BY + OFFSET/FETCH; it was not measured on its own - NEEDS
 * VALIDATION, spike §9.42 note). `CODVEND`/`CODTAB` pass through as recorded (0 is not converted to
 * "none": whether 0 means no seller is a business rule). `BLOQUEAR` semantics were not measured: only
 * `S`/`N`/null are accepted, null = not blocked (NEEDS VALIDATION S4).
 */
export const CUSTOMER_SPEC: EntitySpec<Customer> = {
  entity: 'customers',
  table: 'TGFPAR',
  select: ['CODPARC', 'NOMEPARC', 'RAZAOSOCIAL', 'CGC_CPF', 'ATIVO', 'BLOQUEAR', 'CODVEND', 'CODTAB', 'LIMCRED'],
  columns: ['CODPARC', 'NOMEPARC', 'RAZAOSOCIAL', 'CGC_CPF', 'ATIVO', 'BLOQUEAR', 'CODVEND', 'CODTAB', 'LIMCRED'],
  where: "CLIENTE = 'S'",
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
    };
  },
  keyOf: (customer) => [customer.code],
};

/**
 * TGFPRO (§9.30 F-26, §9.35). PK CODPROD. `CODVOL` is the unit of measure. `USOPROD` is mirrored raw;
 * whether it makes the product sellable is configuration only (CFG-1..6).
 */
export const PRODUCT_SPEC: EntitySpec<Product> = {
  entity: 'products',
  table: 'TGFPRO',
  select: ['CODPROD', 'DESCRPROD', 'ATIVO', 'USOPROD', 'CODGRUPOPROD', 'CODVOL', 'MARCA', 'REFERENCIA'],
  columns: ['CODPROD', 'DESCRPROD', 'ATIVO', 'USOPROD', 'CODGRUPOPROD', 'CODVOL', 'MARCA', 'REFERENCIA'],
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
  }),
  keyOf: (product) => [product.code],
};

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

export function compareKeys(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
