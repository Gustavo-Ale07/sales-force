// Module: mirror — local read model of Sankhya data (Sankhya is the system of record, P-02).
//
// Conventions for every mirror table:
//  - keyed by the natural (source) key; no Sankhya-specific table/column names appear here;
//  - `content_hash`: hash of the mapped content; upserts run only when it differs;
//  - `source_changed_at`: change timestamp reported by the source, when available;
//  - `synced_at`: last time the row was confirmed by a sync run;
//  - `deleted_at`: soft delete, set by reconciliation only.
//  - No FKs between mirror tables: a sync may deliver rows in any order and the source can
//    reference codes that are absent from a snapshot; consumers treat a missing referent as unknown.
//  - NO cost, margin or commission columns exist (P-20).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

const mirrorColumns = () => ({
  contentHash: text('content_hash').notNull(),
  sourceChangedAt: timestamp('source_changed_at', { withTimezone: true }),
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const erpSeller = pgTable(
  'erp_seller',
  {
    code: integer('code').primaryKey(),
    name: text('name').notNull(),
    active: boolean('active').notNull(),
    /** Raw source seller-type code (not reliable to identify sellers, F-37). */
    typeCode: text('type_code'),
    ...mirrorColumns(),
  },
  (t) => [
    // Serves: seller filter/list (active sellers ordered by name).
    index('erp_seller_active_name_idx').on(t.active, t.name).where(sql`${t.deletedAt} is null`),
  ],
);

export const erpCustomer = pgTable(
  'erp_customer',
  {
    code: integer('code').primaryKey(),
    name: text('name').notNull(),
    tradeName: text('trade_name'),
    /** Digits only (CPF/CNPJ). */
    taxId: text('tax_id'),
    /** 'F' individual, 'J' company (raw). */
    personType: text('person_type'),
    email: text('email'),
    phone: text('phone'),
    city: text('city'),
    state: text('state'),
    sellerCode: integer('seller_code'),
    /** NULL = "no resolved price table" (never coerced to a default table). */
    priceTableCode: integer('price_table_code'),
    /** Credit limit as reported; NULL = not reported. */
    creditLimit: numeric('credit_limit', { precision: 14, scale: 2 }),
    active: boolean('active').notNull(),
    /** Whether the partner is flagged as a customer at the source. */
    isCustomer: boolean('is_customer').notNull(),
    /** Raw block flag exactly as reported by the source; interpretation is configuration/domain. */
    blockedRaw: text('blocked_raw'),
    ...mirrorColumns(),
  },
  (t) => [
    check(
      'erp_customer_person_type_chk',
      sql`${t.personType} is null or ${t.personType} in ('F', 'J')`,
    ),
    check('erp_customer_credit_limit_chk', sql`${t.creditLimit} is null or ${t.creditLimit} >= 0`),
    // Customer search (name / trade name / tax id / code): trigram GIN, live rows only.
    index('erp_customer_name_trgm_idx')
      .using('gin', t.name.op('gin_trgm_ops'))
      .where(sql`${t.deletedAt} is null`),
    index('erp_customer_trade_name_trgm_idx')
      .using('gin', t.tradeName.op('gin_trgm_ops'))
      .where(sql`${t.deletedAt} is null`),
    index('erp_customer_tax_id_trgm_idx')
      .using('gin', t.taxId.op('gin_trgm_ops'))
      .where(sql`${t.deletedAt} is null`),
    // Serves: seller-scoped portfolio (role seller) with active filter, ordered by name.
    index('erp_customer_seller_active_name_idx')
      .on(t.sellerCode, t.active, t.name)
      .where(sql`${t.deletedAt} is null`),
    // Serves: manager/admin portfolio listing ordered by name, filtered by active.
    index('erp_customer_active_name_idx').on(t.active, t.name).where(sql`${t.deletedAt} is null`),
    // Serves: hasPriceTable filter and per-table customer counts.
    index('erp_customer_price_table_code_idx')
      .on(t.priceTableCode)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const erpProduct = pgTable(
  'erp_product',
  {
    code: integer('code').primaryKey(),
    description: text('description').notNull(),
    reference: text('reference'),
    brand: text('brand'),
    unit: text('unit'),
    groupCode: integer('group_code'),
    groupName: text('group_name'),
    /** Raw source usage code; "sellable" is decided by configuration (products.sellableUsageValues). */
    usageCode: text('usage_code'),
    active: boolean('active').notNull(),
    ...mirrorColumns(),
  },
  (t) => [
    // Product search (description / reference): trigram GIN, live rows only.
    index('erp_product_description_trgm_idx')
      .using('gin', t.description.op('gin_trgm_ops'))
      .where(sql`${t.deletedAt} is null`),
    index('erp_product_reference_trgm_idx')
      .using('gin', t.reference.op('gin_trgm_ops'))
      .where(sql`${t.deletedAt} is null`),
    // Serves: catalog listing filtered by group and active, ordered by description.
    index('erp_product_group_active_description_idx')
      .on(t.groupCode, t.active, t.description)
      .where(sql`${t.deletedAt} is null`),
    // Serves: catalog listing filtered by active, ordered by description.
    index('erp_product_active_description_idx')
      .on(t.active, t.description)
      .where(sql`${t.deletedAt} is null`),
    // Serves: sellable filter (usage code in the configured set).
    index('erp_product_usage_code_idx').on(t.usageCode).where(sql`${t.deletedAt} is null`),
  ],
);

export const erpPriceTable = pgTable(
  'erp_price_table',
  {
    code: integer('code').primaryKey(),
    name: text('name'),
    active: boolean('active').notNull(),
    originTableCode: integer('origin_table_code'),
    /** Percentage adjustment as reported. Precision NEEDS VALIDATION (S2). */
    percent: numeric('percent', { precision: 12, scale: 6 }),
    ...mirrorColumns(),
  },
  (t) => [
    // Serves: price table selector (active tables ordered by name).
    index('erp_price_table_active_name_idx')
      .on(t.active, t.name)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const erpPriceTableVersion = pgTable(
  'erp_price_table_version',
  {
    versionId: integer('version_id').primaryKey(),
    tableCode: integer('table_code').notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    ...mirrorColumns(),
  },
  (t) => [
    // Serves: effective version per table = latest effective_from <= now (F-39).
    index('erp_price_table_version_table_effective_idx')
      .on(t.tableCode, t.effectiveFrom.desc())
      .where(sql`${t.deletedAt} is null`),
  ],
);

/**
 * Absent row = "no price". An explicit row with unit_price = 0 = "zero price". Kept distinct (P-09).
 * List prices only: no cost or margin data (P-20).
 */
export const erpListPrice = pgTable(
  'erp_list_price',
  {
    versionId: integer('version_id').notNull(),
    productCode: integer('product_code').notNull(),
    unitPrice: numeric('unit_price', { precision: 18, scale: 6 }).notNull(),
    ...mirrorColumns(),
  },
  (t) => [
    primaryKey({ name: 'erp_list_price_pk', columns: [t.versionId, t.productCode] }),
    check('erp_list_price_unit_price_chk', sql`${t.unitPrice} >= 0`),
    // Serves: price of a product across versions (product detail, price-state facet).
    index('erp_list_price_product_code_idx')
      .on(t.productCode, t.versionId)
      .where(sql`${t.deletedAt} is null`),
  ],
);
