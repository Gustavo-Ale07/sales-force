// Module: orders — Sales Force draft orders. Statuses beyond draft/cancelled exist as columns only:
// nothing sends an order to the ERP in this slice (SNK-4, SNK-5 unresolved).
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  bigint,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { inList } from './_util.js';
import { account } from './iam.js';
import { installationConfigurationVersion } from './platform.js';

export const orderStatuses = [
  'draft',
  'cancelled',
  'queued',
  'sent',
  'rejected',
  'unknown',
] as const;
export type OrderStatus = (typeof orderStatuses)[number];

export const priceStates = ['priced', 'zero', 'none'] as const;
export type PriceState = (typeof priceStates)[number];

export const salesOrder = pgTable(
  'sales_order',
  {
    id: uuid('id').primaryKey(),
    /** Human-facing sequential draft number (identity; not an id). */
    draftNumber: integer('draft_number').generatedAlwaysAsIdentity().notNull(),
    /** Customer code as mirrored (no FK: mirror rows are soft-deleted and owned by another module). */
    customerCode: integer('customer_code').notNull(),
    sellerCode: integer('seller_code'),
    createdByAccountId: uuid('created_by_account_id')
      .notNull()
      .references(() => account.id),
    status: text('status').notNull().default('draft'),
    negotiationTypeCode: integer('negotiation_type_code'),
    notes: text('notes'),
    /** Estimate from list prices only (sum of priced lines); the ERP computes the final value. */
    estimatedTotal: numeric('estimated_total', { precision: 14, scale: 2 }).notNull().default('0'),
    /** Optimistic concurrency counter. */
    version: integer('version').notNull().default(1),
    /** Client-generated idempotency key for creation. */
    clientRequestId: uuid('client_request_id').notNull(),
    /** Unresolved integration point (SNK-5): never populated today. */
    externalOriginId: text('external_origin_id'),
    /** ERP order number once known. */
    erpNumber: bigint('erp_number', { mode: 'number' }),
    configVersionId: uuid('config_version_id')
      .notNull()
      .references(() => installationConfigurationVersion.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('sales_order_status_chk', sql`${t.status} in (${inList(orderStatuses)})`),
    check('sales_order_estimated_total_chk', sql`${t.estimatedTotal} >= 0`),
    check('sales_order_version_chk', sql`${t.version} >= 1`),
    // Idempotent creation. Serves: POST /orders replay lookup.
    uniqueIndex('sales_order_client_request_id_uq').on(t.clientRequestId),
    // Multiple NULLs allowed; a non-null origin id can never be reused (SNK-4).
    uniqueIndex('sales_order_external_origin_id_uq').on(t.externalOriginId),
    // Serves: search by draft number.
    uniqueIndex('sales_order_draft_number_uq').on(t.draftNumber),
    // Serves: orders of a customer, newest first (customer detail, filter customerCode).
    index('sales_order_customer_updated_idx').on(t.customerCode, t.updatedAt.desc()),
    // Serves: orders list filtered by status, newest first.
    index('sales_order_status_updated_idx').on(t.status, t.updatedAt.desc()),
    // Serves: orders list scoped to a seller account, newest first.
    index('sales_order_created_by_updated_idx').on(t.createdByAccountId, t.updatedAt.desc()),
    // Serves: unfiltered orders list (manager/admin), newest first; dashboard recent orders.
    index('sales_order_updated_idx').on(t.updatedAt.desc()),
    // Serves: seller-scoped listing/dashboard by seller code.
    index('sales_order_seller_updated_idx').on(t.sellerCode, t.updatedAt.desc()),
    index('sales_order_config_version_id_idx').on(t.configVersionId),
  ],
);

export const salesOrderItem = pgTable(
  'sales_order_item',
  {
    id: uuid('id').primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => salesOrder.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    productCode: integer('product_code').notNull(),
    /** Snapshot of the description at the time of the draft. */
    productDescription: text('product_description').notNull(),
    unit: text('unit'),
    /** Quantity precision NEEDS VALIDATION (S2). */
    quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull(),
    /** List price (not a transactional price). NULL exactly when price_state = 'none'. */
    unitListPrice: numeric('unit_list_price', { precision: 18, scale: 6 }),
    priceState: text('price_state').notNull(),
    priceTableCode: integer('price_table_code'),
    priceVersionId: integer('price_version_id'),
    estimatedLineTotal: numeric('estimated_line_total', { precision: 14, scale: 2 }),
  },
  (t) => [
    check('sales_order_item_quantity_chk', sql`${t.quantity} > 0`),
    check('sales_order_item_line_no_chk', sql`${t.lineNo} > 0`),
    check('sales_order_item_price_state_chk', sql`${t.priceState} in (${inList(priceStates)})`),
    check(
      'sales_order_item_unit_list_price_chk',
      sql`${t.unitListPrice} is null or ${t.unitListPrice} >= 0`,
    ),
    // "no price" (none) is distinct from "zero price" (zero): the price value and state must agree.
    check(
      'sales_order_item_price_state_consistency_chk',
      sql`(${t.priceState} = 'none' and ${t.unitListPrice} is null and ${t.estimatedLineTotal} is null)
        or (${t.priceState} = 'zero' and ${t.unitListPrice} is not null and ${t.unitListPrice} = 0)
        or (${t.priceState} = 'priced' and ${t.unitListPrice} is not null and ${t.unitListPrice} > 0 and ${t.estimatedLineTotal} is not null)`,
    ),
    check(
      'sales_order_item_estimated_line_total_chk',
      sql`${t.estimatedLineTotal} is null or ${t.estimatedLineTotal} >= 0`,
    ),
    // Serves: load items of an order in line order; guarantees stable line numbers.
    uniqueIndex('sales_order_item_order_line_uq').on(t.orderId, t.lineNo),
    // Serves: "orders containing product X" lookups.
    index('sales_order_item_product_code_idx').on(t.productCode),
  ],
);
