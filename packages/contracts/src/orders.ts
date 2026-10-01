import { z } from 'zod';
import { ListPriceStateSchema } from './catalog.js';
import { DatasetIdentitySchema } from './configuration.js';
import {
  DecimalStringSchema,
  IsoTimestampSchema,
  UuidSchema,
  codeInt,
  named,
  paginated,
  paginationQueryShape,
  queryDate,
  queryInt,
  queryIntList,
  querySearch,
} from './primitives.js';

/** Only `draft` and `cancelled` are reachable today; the rest exist for the persistence layer. */
export const OrderStatusSchema = named(
  'OrderStatus',
  z.enum(['draft', 'cancelled', 'queued', 'sent', 'rejected', 'unknown']),
);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

/** Stable codes of the domain draft invariants, reported in `ApiError.details.issues[].code`. */
export const DraftIssueCodeSchema = named(
  'DraftIssueCode',
  z.enum([
    'installation_not_enabled',
    'status_not_editable',
    'invalid_line_number',
    'duplicate_line_number',
    'invalid_quantity',
    'invalid_discount',
    'price_state_inconsistent',
    'price_reference_missing',
    'line_total_mismatch',
    'line_not_orderable',
    'product_unknown',
    'product_not_sellable',
    'negotiation_type_not_configured',
    'order_total_mismatch',
    'order_total_out_of_range',
  ]),
);
export type DraftIssueCode = z.infer<typeof DraftIssueCodeSchema>;

/* ---------- list ---------- */

export const OrderSortSchema = named(
  'OrderSort',
  z.enum(['updatedAt', '-updatedAt', 'draftNumber', '-draftNumber']),
);

/**
 * Which date the period filter (`from`/`to`) applies to. Sales Force only records two dates for an order:
 * when the draft was created (the "Data" shown in the list) and when it last changed. There is no separate
 * emission / sale / invoice date until the ERP submission exists.
 */
export const OrderDateFieldSchema = named('OrderDateField', z.enum(['createdAt', 'updatedAt']));

/** How several product filters combine: the order has AT LEAST ONE of them (`any`) or ALL of them (`all`). */
export const OrderProductMatchSchema = named('OrderProductMatch', z.enum(['any', 'all']));

export const MAX_ORDER_PRODUCT_FILTER = 20;

export const OrdersQuerySchema = z.object({
  search: querySearch().optional(),
  status: OrderStatusSchema.optional(),
  customerCode: queryInt(0).optional(),
  /** Period, inclusive on both ends, as calendar dates in the business time zone (America/Sao_Paulo). */
  from: queryDate().optional(),
  to: queryDate().optional(),
  /** Date the period applies to; `createdAt` when omitted. */
  dateField: OrderDateFieldSchema.optional(),
  /** Product codes, comma-separated (at most 20): orders with a line for those products. */
  productCodes: queryIntList(MAX_ORDER_PRODUCT_FILTER).optional(),
  /** `any` (default): at least one of the products; `all`: every one of them. Ignored without `productCodes`. */
  productMatch: OrderProductMatchSchema.optional(),
  /** Text of a product description (or a product code): orders with a line that contains it. Combines with `productCodes`. */
  productSearch: querySearch().optional(),
  sort: OrderSortSchema.default('-updatedAt'),
  ...paginationQueryShape,
});
export type OrdersQuery = z.infer<typeof OrdersQuerySchema>;

export const OrderListItemSchema = named(
  'OrderListItem',
  z.object({
    id: UuidSchema,
    draftNumber: z.number().int().min(1),
    customerCode: codeInt(),
    customerName: z.string(),
    sellerCode: codeInt().nullable(),
    status: OrderStatusSchema,
    /** Estimate from list prices; the final value is calculated by the ERP. */
    estimatedTotal: DecimalStringSchema,
    itemCount: z.number().int().min(0),
    /**
     * Descriptions of up to 3 lines, for a glance at the list. When the list is filtered by product, the
     * matching lines come first; otherwise they follow the line number.
     */
    itemPreview: z.array(z.string()).max(3),
    /** True when at least one line has no price, so the estimate does not cover the whole order. */
    isPartial: z.boolean(),
    /** ERP order number once the order exists there; always `null` while submission is disabled. */
    erpNumber: z.number().int().nullable(),
    version: z.number().int().min(1),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  }),
);
export type OrderListItem = z.infer<typeof OrderListItemSchema>;

export const OrdersResponseSchema = paginated('OrdersResponse', OrderListItemSchema);
export type OrdersResponse = z.infer<typeof OrdersResponseSchema>;

/* ---------- detail ---------- */

/** Priced order line, as computed server-side from the price mirror (mirrors the domain `OrderItem`). */
export const OrderItemSchema = named(
  'OrderItem',
  z.object({
    lineNo: z.number().int().min(1),
    productCode: codeInt(),
    productDescription: z.string(),
    unit: z.string(),
    quantity: DecimalStringSchema,
    /** `null` when the price state is `none` (missing price is never 0). */
    unitListPrice: DecimalStringSchema.nullable(),
    priceState: ListPriceStateSchema,
    priceTableCode: codeInt().nullable(),
    priceVersionId: codeInt().nullable(),
    /** Percentage discount on the list price (`"0"` when none). Approval by authority is not modelled yet (P-10; R35/R36). */
    discountPercent: DecimalStringSchema,
    /** Estimate from the list price with the line discount; `null` when the price state is `none`. */
    estimatedLineTotal: DecimalStringSchema.nullable(),
  }),
);
export type OrderItem = z.infer<typeof OrderItemSchema>;

export const OrderTotalsSchema = named(
  'OrderTotals',
  z.object({
    estimatedTotal: DecimalStringSchema,
    lineCount: z.number().int().min(0),
    unpricedLineCount: z.number().int().min(0),
    isPartial: z.boolean(),
  }),
);
export type OrderTotals = z.infer<typeof OrderTotalsSchema>;

export const OrderDetailSchema = named(
  'OrderDetail',
  z.object({
    // The detail lists every line, so the list preview does not apply.
    ...OrderListItemSchema.omit({ itemPreview: true }).shape,
    negotiationTypeCode: codeInt().nullable(),
    notes: z.string().nullable(),
    items: z.array(OrderItemSchema),
    totals: OrderTotalsSchema,
  }),
);
export type OrderDetail = z.infer<typeof OrderDetailSchema>;

export const OrderPathSchema = z.object({ id: UuidSchema });

/* ---------- create / replace draft ---------- */

export const MAX_ORDER_ITEMS = 500;

/**
 * Dataset trust boundary: every request that creates or changes an order from client-chosen data states the dataset
 * (`GET /order-entry/configuration` -> `dataset`) the data originated from. The server compares it with its own declared
 * identity BEFORE any write and answers 409 `dataset_mismatch` (also when it declares none). Required, no default.
 */
export const expectedDatasetField = DatasetIdentitySchema;

/**
 * A requested line: product, quantity and an optional discount percentage. Prices, totals and descriptions are always
 * resolved server-side from the mirror; a client-sent price is rejected (unrecognized key), never
 * silently ignored (P-09).
 */
export const OrderItemInputSchema = named(
  'OrderItemInput',
  z.strictObject({
    productCode: codeInt(),
    /** Positive decimal string with at most 4 decimals (validated again by the domain). */
    quantity: DecimalStringSchema,
    /** Percentage discount on the list price, 0 to 99.99 with at most 2 decimals; omitted means 0. Validated again by the domain. */
    discountPercent: DecimalStringSchema.optional(),
  }),
);
export type OrderItemInput = z.infer<typeof OrderItemInputSchema>;

const orderDraftFields = {
  customerCode: codeInt(),
  negotiationTypeCode: codeInt().nullable(),
  notes: z.string().max(2000).nullable(),
  items: z.array(OrderItemInputSchema).max(MAX_ORDER_ITEMS),
};

/** `POST /orders`. Idempotent on `clientRequestId`: a replay returns the original order. */
export const CreateOrderRequestSchema = named(
  'CreateOrderRequest',
  z.strictObject({
    clientRequestId: UuidSchema,
    expectedDataset: expectedDatasetField,
    ...orderDraftFields,
  }),
);
export type CreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;

/** `PUT /orders/{id}`: full replace of a draft with optimistic concurrency. */
export const ReplaceOrderRequestSchema = named(
  'ReplaceOrderRequest',
  z.strictObject({
    expectedVersion: z.number().int().min(1),
    expectedDataset: expectedDatasetField,
    ...orderDraftFields,
  }),
);
export type ReplaceOrderRequest = z.infer<typeof ReplaceOrderRequestSchema>;

/**
 * `POST /customers/{code}/orders/repeat-last`. One `clientRequestId` per user action (it becomes the
 * new draft's own request id), same shape as `UseOrderTemplateRequest`.
 */
export const RepeatLastOrderRequestSchema = named(
  'RepeatLastOrderRequest',
  z.strictObject({ clientRequestId: UuidSchema, expectedDataset: expectedDatasetField }),
);
export type RepeatLastOrderRequest = z.infer<typeof RepeatLastOrderRequestSchema>;
