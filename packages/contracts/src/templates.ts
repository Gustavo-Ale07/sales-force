import { z } from 'zod';
import { OrderDetailSchema, expectedDatasetField } from './orders.js';
import { DecimalStringSchema, IsoTimestampSchema, UuidSchema, codeInt, named } from './primitives.js';

/**
 * Recurring order templates ("pedido recorrente"): a saved list of product + quantity for one
 * customer. No price, discount or note is ever stored or accepted; using a template creates a NEW
 * draft order that is priced from the current catalog and is not linked to the template.
 */

export const MAX_ORDER_TEMPLATE_ITEMS = 500;
export const MAX_ORDER_TEMPLATES_PER_CUSTOMER = 50;
export const MAX_ORDER_TEMPLATE_NAME_LENGTH = 80;

/** Trimmed, 1..80 characters, no control characters. Unique per customer, ignoring case, among live templates. */
const TemplateNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_ORDER_TEMPLATE_NAME_LENGTH)
  // eslint-disable-next-line no-control-regex
  .regex(/^[^\u0000-\u001f\u007f-\u009f]+$/, 'Control characters are not allowed');

/** Product and quantity only. A client-sent price or any other key is rejected, never ignored. */
export const OrderTemplateItemSchema = named(
  'OrderTemplateItem',
  z.strictObject({
    productCode: codeInt(),
    /** Positive decimal string with at most 4 decimals (validated again by the domain). */
    quantity: DecimalStringSchema,
  }),
);
export type OrderTemplateItem = z.infer<typeof OrderTemplateItemSchema>;

const templateItemsSchema = z.array(OrderTemplateItemSchema).min(1).max(MAX_ORDER_TEMPLATE_ITEMS);

export const OrderTemplateSchema = named(
  'OrderTemplate',
  z.object({
    id: UuidSchema,
    customerCode: codeInt(),
    name: z.string(),
    version: z.number().int().min(1),
    itemCount: z.number().int().min(0),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
  }),
);
export type OrderTemplate = z.infer<typeof OrderTemplateSchema>;

export const OrderTemplateDetailSchema = named(
  'OrderTemplateDetail',
  z.object({
    ...OrderTemplateSchema.shape,
    /** In template order. */
    items: z.array(OrderTemplateItemSchema),
  }),
);
export type OrderTemplateDetail = z.infer<typeof OrderTemplateDetailSchema>;

/** At most 50 live templates per customer, so there is no pagination. */
export const OrderTemplatesResponseSchema = named(
  'OrderTemplatesResponse',
  z.object({ items: z.array(OrderTemplateSchema) }),
);
export type OrderTemplatesResponse = z.infer<typeof OrderTemplatesResponseSchema>;

export const OrderTemplatePathSchema = z.object({ id: UuidSchema });

/** `POST /customers/{code}/order-templates`. Idempotent on `clientRequestId` (per account). */
export const CreateOrderTemplateRequestSchema = named(
  'CreateOrderTemplateRequest',
  z.strictObject({
    clientRequestId: UuidSchema,
    expectedDataset: expectedDatasetField,
    name: TemplateNameSchema,
    items: templateItemsSchema,
  }),
);
export type CreateOrderTemplateRequest = z.infer<typeof CreateOrderTemplateRequestSchema>;

/** `PUT /order-templates/{id}`: full replace with optimistic concurrency. */
export const ReplaceOrderTemplateRequestSchema = named(
  'ReplaceOrderTemplateRequest',
  z.strictObject({
    expectedVersion: z.number().int().min(1),
    expectedDataset: expectedDatasetField,
    name: TemplateNameSchema,
    items: templateItemsSchema,
  }),
);
export type ReplaceOrderTemplateRequest = z.infer<typeof ReplaceOrderTemplateRequestSchema>;

/** `POST /order-templates/{id}/use`. One `clientRequestId` per user action (it becomes the draft's own request id). */
export const UseOrderTemplateRequestSchema = named(
  'UseOrderTemplateRequest',
  z.strictObject({ clientRequestId: UuidSchema, expectedDataset: expectedDatasetField }),
);
export type UseOrderTemplateRequest = z.infer<typeof UseOrderTemplateRequestSchema>;

/** Why a template line did not become an order line. */
export const TemplateLineSkipReasonSchema = named(
  'TemplateLineSkipReason',
  z.enum([
    'product_removed',
    'product_inactive',
    'no_price',
    'zero_price',
    'product_hidden',
    'product_not_sellable',
  ]),
);
export type TemplateLineSkipReason = z.infer<typeof TemplateLineSkipReasonSchema>;

export const SkippedTemplateLineSchema = named(
  'SkippedTemplateLine',
  z.object({
    /** Position (1-based) of the line in the template. */
    lineNo: z.number().int().min(1),
    productCode: codeInt(),
    reason: TemplateLineSkipReasonSchema,
  }),
);
export type SkippedTemplateLine = z.infer<typeof SkippedTemplateLineSchema>;

export const UseOrderTemplateResponseSchema = named(
  'UseOrderTemplateResponse',
  z.object({
    /** The new, independent draft (priced now from the current catalog). */
    order: OrderDetailSchema,
    /** Template lines left out of the draft, in template order; empty when every line was used. */
    skippedLines: z.array(SkippedTemplateLineSchema),
  }),
);
export type UseOrderTemplateResponse = z.infer<typeof UseOrderTemplateResponseSchema>;

/**
 * Response of `POST /customers/{code}/orders/repeat-last` ("Repetir último pedido", Phase C). Shares
 * the skip-reason vocabulary with order templates because it goes through the very same
 * classification (`classifyTemplateLines`) against the current catalog; the source is the customer's
 * own most recent non-cancelled order recorded in Sales Force, never Sankhya/ERP history. Declared
 * here (not in orders.ts) because it needs both `OrderDetailSchema` (owned by orders.ts) and
 * `SkippedTemplateLineSchema` (owned here); orders.ts intentionally never imports from this file, to
 * keep the contracts module graph acyclic.
 */
export const RepeatLastOrderResponseSchema = named(
  'RepeatLastOrderResponse',
  z.object({
    /** The new, independent draft (priced now from the current catalog). */
    order: OrderDetailSchema,
    /** Lines of the source order left out of the draft, in the source order's line order. */
    skippedLines: z.array(SkippedTemplateLineSchema),
  }),
);
export type RepeatLastOrderResponse = z.infer<typeof RepeatLastOrderResponseSchema>;
