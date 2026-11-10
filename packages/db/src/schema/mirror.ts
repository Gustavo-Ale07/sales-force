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
  date,
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

/** Carriers (partners flagged as carrier in the ERP): code, display name and active flag only (D-C). */
export const erpCarrier = pgTable('erp_carrier', {
  code: integer('code').primaryKey(),
  name: text('name').notNull(),
  active: boolean('active').notNull(),
  ...mirrorColumns(),
});

/**
 * Product group hierarchy (TGFGRU): code, name, parent, degree (1 = top level), the analytic flag (the group itself holds
 * products) and the active flag. `parent_code` is null for a top-level group; the hierarchy is read by `parent_code`, never by
 * code prefix. Group 0 ("sem grupo") is never mirrored. Complete snapshot every run. Feeds the Grupo > Subgrupo > Linha filter.
 */
export const erpProductGroup = pgTable(
  'erp_product_group',
  {
    code: integer('code').primaryKey(),
    name: text('name').notNull(),
    parentCode: integer('parent_code'),
    degree: integer('degree').notNull(),
    analytic: boolean('analytic').notNull(),
    active: boolean('active').notNull(),
    ...mirrorColumns(),
  },
  (t) => [
    // Serves: children of a group (cascading filter) and the top level (parent_code is null).
    index('erp_product_group_parent_idx').on(t.parentCode).where(sql`${t.deletedAt} is null`),
  ],
);

/**
 * IPI rates (TGFIPI): code, description, rate in percent and the tariff (pauta) flag. Used for the display ESTIMATE of the
 * IPI only (D-D); the ERP calculates the real value. Replaced in full on every run (a handful of rows).
 */
export const erpIpiRate = pgTable('erp_ipi_rate', {
  code: integer('code').primaryKey(),
  description: text('description').notNull(),
  percentual: numeric('percentual', { precision: 9, scale: 4 }).notNull(),
  byTariff: boolean('by_tariff').notNull(),
  /** The ERP code has no rate (exempt / not taxed): `percentual` is 0.00 and is not a real 0% (H1). */
  rateMissing: boolean('rate_missing').default(false).notNull(),
  ...mirrorColumns(),
});

/**
 * Open receivable titles (read-only financial information, D-I). Complete snapshot every run: a settled title is absent from the
 * next snapshot and is soft-deleted by reconciliation. `amount` is the title value, `paid_amount` what was already settled.
 * Not a foreign key to the customer: the mirrors load independently.
 */
export const erpOpenTitle = pgTable(
  'erp_open_title',
  {
    nufin: integer('nufin').primaryKey(),
    customerCode: integer('customer_code').notNull(),
    companyCode: integer('company_code'),
    documentNumber: integer('document_number'),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    paidAmount: numeric('paid_amount', { precision: 14, scale: 2 }).notNull(),
    ...mirrorColumns(),
  },
  (t) => [
    check('erp_open_title_amounts_chk', sql`${t.amount} >= 0 and ${t.paidAmount} >= 0`),
    // Serves: per-customer title list ordered by due date and the per-customer summary, live rows only.
    index('erp_open_title_customer_due_idx').on(t.customerCode, t.dueDate).where(sql`${t.deletedAt} is null`),
  ],
);

/**
 * Official ERP user -> seller relation (TSIUSU.CODUSU / CODVEND), the ONLY user data mirrored: no name, e-mail, credential or
 * permission column exists. Read by the identity module to provision and reconcile seller accounts; never exposed by an endpoint.
 */
export const erpDirectoryUser = pgTable(
  'erp_directory_user',
  {
    code: integer('code').primaryKey(),
    /** `null` = the ERP user has no seller. */
    sellerCode: integer('seller_code'),
    ...mirrorColumns(),
  },
  (t) => [
    // Serves: "which ERP users claim seller X" (ambiguity check at provisioning and reconciliation).
    index('erp_directory_user_seller_code_idx').on(t.sellerCode).where(sql`${t.deletedAt} is null`),
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
    /** Monthly credit limit as reported (informational, D-I); NULL = not reported. */
    monthlyCreditLimit: numeric('monthly_credit_limit', { precision: 14, scale: 2 }),
    /** Reason recorded with the block at the source (informational text). */
    blockReason: text('block_reason'),
    /** Situation code as reported (raw, informational). */
    situation: text('situation'),
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
    /** ERP IPI code (TGFPRO.CODIPI) -> erp_ipi_rate.code. NULL = no IPI code. Not a foreign key: the mirrors load independently. */
    ipiCode: integer('ipi_code'),
    /** Selling step (TGFPRO.AGRUPMIN): quantities are multiples of it. NULL = no rule (step 0.01). */
    quantityStep: numeric('quantity_step', { precision: 14, scale: 4 }),
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
