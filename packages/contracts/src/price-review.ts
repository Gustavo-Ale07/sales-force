import { z } from 'zod';
import { expectedDatasetField } from './orders.js';
import { DecimalStringSchema, codeInt, named } from './primitives.js';

/**
 * Item-by-item price review (P-09): lines of a draft whose table price changed since the line was priced. The seller
 * accepts (the line takes the current price) or refuses (the line leaves the order) each one; the server prices again.
 */

export const PriceReviewLineSchema = named(
  'PriceReviewLine',
  z.object({
    lineNo: z.number().int().min(1),
    productCode: codeInt(),
    productDescription: z.string(),
    unit: z.string(),
    quantity: DecimalStringSchema,
    /** Unit price the line carries now; `null` = "Sem preço". */
    previousUnitPrice: DecimalStringSchema.nullable(),
    /** Unit price of the table today; `null` = "Sem preço". */
    currentUnitPrice: DecimalStringSchema.nullable(),
  }),
);
export type PriceReviewLine = z.infer<typeof PriceReviewLineSchema>;

export const OrderPriceReviewSchema = named(
  'OrderPriceReview',
  z.object({
    orderId: z.string().uuid(),
    /** Version the review was computed against; sent back as `expectedVersion`. */
    version: z.number().int().min(1),
    /** Only the lines whose price changed; empty = nothing to review. */
    lines: z.array(PriceReviewLineSchema),
  }),
);
export type OrderPriceReview = z.infer<typeof OrderPriceReviewSchema>;

export const PriceReviewDecisionSchema = named('PriceReviewDecision', z.enum(['accept', 'refuse']));
export type PriceReviewDecision = z.infer<typeof PriceReviewDecisionSchema>;

/** `POST /orders/{id}/price-review`: one decision for every line the review listed. */
export const ResolvePriceReviewRequestSchema = named(
  'ResolvePriceReviewRequest',
  z.strictObject({
    expectedVersion: z.number().int().min(1),
    expectedDataset: expectedDatasetField,
    decisions: z
      .array(z.strictObject({ lineNo: z.number().int().min(1), decision: PriceReviewDecisionSchema }))
      .min(1)
      .max(500),
  }),
);
export type ResolvePriceReviewRequest = z.infer<typeof ResolvePriceReviewRequestSchema>;

