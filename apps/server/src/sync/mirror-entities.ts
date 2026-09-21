import {
  erpCustomer,
  erpListPrice,
  erpPriceTable,
  erpPriceTableVersion,
  erpProduct,
  erpSeller,
} from '@salesforce/db';
import type { Customer, ListPrice, PriceTable, PriceTableVersion, Product, Seller } from '@salesforce/domain';
import {
  SankhyaGatewayError,
  type GatewayDescription,
  type ReadEntity,
  type ReadOptions,
  type SankhyaReadPort,
  type Snapshot,
} from '@salesforce/sankhya';
import type { PgTable } from 'drizzle-orm/pg-core';

/**
 * Mirror entities of Phase 0 (roadmap WP 0.8, Q-02): sellers, customers/portfolio, products and price
 * tables. Financial titles, sales documents and goals are NOT mirrored here (Q-02 is open).
 *
 * Each spec maps the Sales Force-shaped gateway output onto the columns of one `erp_*` table. Only
 * columns the gateway actually provides are written: a column the gateway does not deliver yet (for
 * example `erp_customer.city`) is left untouched, never defaulted.
 */
export const MIRROR_ENTITIES = [
  'sellers',
  'customers',
  'products',
  'priceTables',
  'priceTableVersions',
  'listPrices',
] as const satisfies readonly ReadEntity[];

export type MirrorEntity = (typeof MIRROR_ENTITIES)[number];

export function isMirrorEntity(value: string): value is MirrorEntity {
  return (MIRROR_ENTITIES as readonly string[]).includes(value);
}

/** Queue of one entity's mirror job (`sync.mirror.<entity>`). */
export const MIRROR_QUEUE_PREFIX = 'sync.mirror.';
export function mirrorQueueName(entity: MirrorEntity): string {
  return `${MIRROR_QUEUE_PREFIX}${entity}`;
}

/**
 * What the sync may call: the read port only. The write port (`SankhyaWritePort`) is deliberately
 * not part of this type, so nothing in the sync can reach `submitOrder` (SNK-4, SNK-6).
 */
export type MirrorGateway = SankhyaReadPort & { describe(): GatewayDescription };

/** One mapped source row: its integer key and the columns to write (Drizzle property names). */
export interface MirrorRow {
  readonly key: readonly number[];
  readonly content: Readonly<Record<string, unknown>>;
}

export interface MirrorReadContext {
  readonly gateway: MirrorGateway;
  readonly description: GatewayDescription;
  readonly signal?: AbortSignal;
  readonly warn: (message: string) => void;
}

export interface MirrorEntitySpec {
  readonly entity: MirrorEntity;
  /** Gateway read that must be `supported` for this entity to run. */
  readonly requires: readonly ReadEntity[];
  /** The mirror table. Every mirror table carries the common columns `contentHash`, `syncedAt`, `deletedAt`. */
  readonly table: PgTable;
  /** Drizzle property names of the primary key columns (one or two integer columns). */
  readonly keyProps: readonly [string] | readonly [string, string];
  /** Mapped batches, in source order. The iteration is COMPLETE only when it finishes without throwing. */
  read(context: MirrorReadContext): AsyncIterable<readonly MirrorRow[]>;
}

// ---------------------------------------------------------------------------------------------
// Value guards (decimal-safe: values stay decimal strings from the gateway to the numeric column)
// ---------------------------------------------------------------------------------------------

function invalid(entity: MirrorEntity, column: string, problem: string): SankhyaGatewayError {
  // Never the value: it may be personal or commercial data.
  return new SankhyaGatewayError('validation', {
    code: 'mirror_value_out_of_range',
    message: `${entity}: column ${column} ${problem}. The row was rejected before writing; the mirror was not changed by this value.`,
  });
}

/**
 * A decimal string that fits `numeric(precision, scale)` WITHOUT rounding. PostgreSQL would round an
 * over-scaled value silently; money is never rounded by storage (DATA-3).
 */
export function fitsNumeric(value: string, precision: number, scale: number): boolean {
  const canonical = canonicalPlainDecimal(value);
  if (canonical === null) return false;
  const [integer = '', fraction = ''] = canonical.split('.');
  return integer.length <= precision - scale && fraction.length <= scale;
}

/**
 * Canonical form of an unsigned plain decimal string (`"2.5000"` -> `"2.5"`, `"007"` -> `"7"`), or
 * `null` when malformed. The same amount always hashes identically, whatever the representation.
 */
export function canonicalPlainDecimal(value: string): string | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  const integer = (match[1] ?? '').replace(/^0+(?=\d)/, '');
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  return fraction === '' ? integer : `${integer}.${fraction}`;
}

function decimalColumn(
  entity: MirrorEntity,
  column: string,
  value: string | null,
  precision: number,
  scale: number,
): string | null {
  if (value === null) return null;
  if (!fitsNumeric(value, precision, scale)) {
    throw invalid(entity, column, `does not fit numeric(${precision},${scale}) without rounding`);
  }
  return canonicalPlainDecimal(value);
}

function keyColumn(entity: MirrorEntity, column: string, value: number): number {
  if (!Number.isInteger(value) || value < -2_147_483_648 || value > 2_147_483_647) {
    throw invalid(entity, column, 'is not a 32-bit integer key');
  }
  return value;
}

/** Digits only (CPF/CNPJ), as the mirror column documents; an empty result means "not reported". */
export function digitsOnly(value: string | null): string | null {
  if (value === null) return null;
  const digits = value.replace(/\D/g, '');
  return digits === '' ? null : digits;
}

function instant(entity: MirrorEntity, column: string, iso: string): Date {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw invalid(entity, column, 'is not a valid timestamp');
  return date;
}

// ---------------------------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------------------------

function mapped<T>(
  snapshot: Snapshot<T>,
  toRow: (row: T) => MirrorRow,
): AsyncIterable<readonly MirrorRow[]> {
  return {
    async *[Symbol.asyncIterator]() {
      for await (const batch of snapshot) yield batch.map(toRow);
    },
  };
}

function readOptions(context: MirrorReadContext): ReadOptions {
  return context.signal === undefined ? {} : { signal: context.signal };
}

const sellers: MirrorEntitySpec = {
  entity: 'sellers',
  requires: ['sellers'],
  table: erpSeller,
  keyProps: ['code'],
  read: (context) =>
    mapped<Seller>(context.gateway.readSellers(readOptions(context)), (row) => ({
      key: [keyColumn('sellers', 'code', row.code)],
      content: { name: row.name, active: row.active },
    })),
};

const customers: MirrorEntitySpec = {
  entity: 'customers',
  requires: ['customers'],
  table: erpCustomer,
  keyProps: ['code'],
  read: (context) =>
    mapped<Customer>(context.gateway.readCustomers(readOptions(context)), (row) => ({
      key: [keyColumn('customers', 'code', row.code)],
      content: {
        name: row.name,
        tradeName: row.tradeName,
        taxId: digitsOnly(row.document),
        sellerCode: row.sellerCode,
        // NULL stays NULL: "no resolved price table", never a default table (CFG-4).
        priceTableCode: row.priceTableCode,
        creditLimit: decimalColumn('customers', 'creditLimit', row.creditLimit, 14, 2),
        active: row.active,
        // The customer snapshot lists customers only (the adapter filters the source flag).
        isCustomer: true,
        // The gateway exposes the flag as a boolean; the raw source code is not visible here.
        // Its business meaning stays configuration/domain territory (NEEDS VALIDATION S4).
        blockedRaw: row.blocked ? 'true' : 'false',
      },
    })),
};

const products: MirrorEntitySpec = {
  entity: 'products',
  requires: ['products'],
  table: erpProduct,
  keyProps: ['code'],
  read: (context) => ({
    async *[Symbol.asyncIterator]() {
      // Group names are denormalized onto the product (`erp_product.group_name`). The group list is
      // small; when the gateway cannot read it yet, the name stays NULL and the code is still mirrored.
      const groupNames = new Map<number, string>();
      if (context.description.capabilities.reads.productGroups === 'supported') {
        for await (const batch of context.gateway.readProductGroups(readOptions(context))) {
          for (const group of batch) groupNames.set(group.code, group.name);
        }
      } else {
        context.warn('productGroups is not implemented by the gateway; group names are not mirrored');
      }
      yield* mapped<Product>(context.gateway.readProducts(readOptions(context)), (row) => ({
        key: [keyColumn('products', 'code', row.code)],
        content: {
          description: row.description,
          reference: row.reference,
          brand: row.brand,
          unit: row.unit,
          groupCode: row.groupCode,
          groupName: row.groupCode === null ? null : (groupNames.get(row.groupCode) ?? null),
          usageCode: row.usageCode,
          active: row.active,
        },
      }));
    },
  }),
};

const priceTables: MirrorEntitySpec = {
  entity: 'priceTables',
  requires: ['priceTables'],
  table: erpPriceTable,
  keyProps: ['code'],
  read: (context) =>
    mapped<PriceTable>(context.gateway.readPriceTables(readOptions(context)), (row) => ({
      key: [keyColumn('priceTables', 'code', row.code)],
      content: {
        name: row.name,
        active: row.active,
        originTableCode: row.originTableCode,
        percent: decimalColumn('priceTables', 'percent', row.percent, 12, 6),
      },
    })),
};

const priceTableVersions: MirrorEntitySpec = {
  entity: 'priceTableVersions',
  requires: ['priceTableVersions'],
  table: erpPriceTableVersion,
  keyProps: ['versionId'],
  read: (context) =>
    mapped<PriceTableVersion>(context.gateway.readPriceTableVersions(readOptions(context)), (row) => ({
      key: [keyColumn('priceTableVersions', 'versionId', row.versionId)],
      content: {
        tableCode: row.tableCode,
        effectiveFrom: instant('priceTableVersions', 'effectiveFrom', row.effectiveFrom),
      },
    })),
};

/**
 * List prices (P-09): only rows that exist in the ERP are written, an explicit zero stays `0`, a
 * product without a row has no row here (missing is never converted to zero). A row that
 * disappears from the source is soft-deleted, i.e. becomes "no price" again.
 */
const listPrices: MirrorEntitySpec = {
  entity: 'listPrices',
  requires: ['listPrices'],
  table: erpListPrice,
  keyProps: ['versionId', 'productCode'],
  read: (context) =>
    mapped<ListPrice>(context.gateway.readListPrices(readOptions(context)), (row) => ({
      key: [keyColumn('listPrices', 'versionId', row.versionId), keyColumn('listPrices', 'productCode', row.productCode)],
      content: { unitPrice: decimalColumn('listPrices', 'unitPrice', row.unitPrice, 18, 6) },
    })),
};

export const MIRROR_SPECS: Readonly<Record<MirrorEntity, MirrorEntitySpec>> = {
  sellers,
  customers,
  products,
  priceTables,
  priceTableVersions,
  listPrices,
};
