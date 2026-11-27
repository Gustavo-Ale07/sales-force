// Module: Force configuration (owner ruling 2026-11-27: every Force setting lives in the Force database and is edited on the
// site; the ERP is only a data source). Singleton installation parameters and per-seller discount rules.
import { sql } from 'drizzle-orm';
import { check, index, integer, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { account } from './iam.js';
import { inList } from './_util.js';

export const discountRuleTargetKinds = ['product', 'subgroup', 'group', 'none'] as const;

/** Installation-wide Force parameters (single row, seeded by the migration). Edited in Configuracoes of the site. */
export const forceConfig = pgTable(
  'force_config',
  {
    id: smallint('id').primaryKey().default(1),
    /** Days the app may stay without a synchronization (offline lock). */
    maxDaysWithoutSync: integer('max_days_without_sync').notNull().default(7),
    /** Price table of a new customer when the seller picks none (must exist in the ERP price-table mirror). */
    defaultPriceTableCode: integer('default_price_table_code').notNull().default(5),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => account.id),
  },
  (t) => [
    check('force_config_singleton_chk', sql`${t.id} = 1`),
    check('force_config_max_days_chk', sql`${t.maxDaysWithoutSync} between 1 and 60`),
    check('force_config_price_table_chk', sql`${t.defaultPriceTableCode} >= 0`),
  ],
);

/**
 * Per-seller discount ceiling. `seller_code` is the Sankhya seller code (same key as account_seller_link and the ERP mirrors); there
 * is no rule without a seller. `target_kind = 'none'` is the seller's general rule (no target code).
 */
export const sellerDiscountRule = pgTable(
  'seller_discount_rule',
  {
    /** UUIDv7 generated outside PostgreSQL (DATA-1). */
    id: uuid('id').primaryKey(),
    sellerCode: integer('seller_code').notNull(),
    targetKind: text('target_kind').notNull(),
    /** Product or group code; NULL for the general rule. */
    targetCode: integer('target_code'),
    maxPercent: numeric('max_percent', { precision: 7, scale: 4 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => account.id),
  },
  (t) => [
    check('seller_discount_rule_kind_chk', sql`${t.targetKind} in (${inList(discountRuleTargetKinds)})`),
    check(
      'seller_discount_rule_target_chk',
      sql`(${t.targetKind} = 'none' and ${t.targetCode} is null) or (${t.targetKind} <> 'none' and ${t.targetCode} is not null and ${t.targetCode} > 0)`,
    ),
    check('seller_discount_rule_percent_chk', sql`${t.maxPercent} >= 0 and ${t.maxPercent} <= 100`),
    check('seller_discount_rule_seller_chk', sql`${t.sellerCode} > 0`),
    // One rule per (seller, target kind, target): the general rule has a NULL code, so it is folded to 0 in the key.
    uniqueIndex('seller_discount_rule_target_uidx').on(t.sellerCode, t.targetKind, sql`coalesce(${t.targetCode}, 0)`),
    // Serves: the seller's own rules (sync of the app, order revalidation) and the manager's filter by seller.
    index('seller_discount_rule_seller_idx').on(t.sellerCode),
  ],
);
