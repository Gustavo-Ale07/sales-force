import { z } from 'zod';
import { IsoTimestampSchema, codeInt, named } from './primitives.js';

/** A limit as the admin screen handles it: a percentage with up to two decimals, 0 to 99.99 (inclusive, Q7). */
const LimitSchema = z.string().regex(/^\d{1,2}(\.\d{1,2})?$/);

/** The three levels, always (Q9). The director limit is the absolute ceiling (Q13). */
export const DiscountLimitsSchema = named(
  'DiscountLimits',
  z.strictObject({ seller: LimitSchema, manager: LimitSchema, director: LimitSchema }),
);
export type DiscountLimits = z.infer<typeof DiscountLimitsSchema>;

/**
 * `GET /discount-limits` (W-39, admin only). `provisional` = the values are the owner's provisional ones,
 * "ajustar pelo dono" (Q11), either not stored yet or stored without the admin's confirmation.
 * `revision` identifies the configuration version these values come from (optimistic concurrency).
 */
export const DiscountLimitsResponseSchema = named(
  'DiscountLimitsResponse',
  z.object({
    limits: DiscountLimitsSchema,
    provisional: z.boolean(),
    revision: z.string().min(1),
    updatedAt: IsoTimestampSchema,
  }),
);
export type DiscountLimitsResponse = z.infer<typeof DiscountLimitsResponseSchema>;

/** `PUT /discount-limits`: the three limits (ascending, inclusive) and the revision the admin saw. */
export const UpdateDiscountLimitsRequestSchema = named(
  'UpdateDiscountLimitsRequest',
  z.strictObject({ expectedRevision: z.string().min(1), limits: DiscountLimitsSchema }),
);
export type UpdateDiscountLimitsRequest = z.infer<typeof UpdateDiscountLimitsRequestSchema>;

/* ---------- per-seller limits registered inside the ERP and mirrored read-only: general, group (any depth), product ---------- */

/** An ERP percentage: 0 to 100, up to four decimals. */
const ErpPercentSchema = z.string().regex(/^(100(\.0+)?|\d{1,2}(\.\d{1,4})?)$/);

export const SellerDiscountKindSchema = named('SellerDiscountKind', z.enum(['general', 'group', 'product']));
export type SellerDiscountKind = z.infer<typeof SellerDiscountKindSchema>;

/** A rule as the client resolves it: `code` is the group or product code, `null` for the general rule. */
export const SellerDiscountRuleSchema = named(
  'SellerDiscountRule',
  z.object({
    kind: SellerDiscountKindSchema,
    code: codeInt().nullable(),
    percent: ErpPercentSchema,
  }),
);
export type SellerDiscountRuleDto = z.infer<typeof SellerDiscountRuleSchema>;

/** `GET /discount-limits/mine`: ONLY the caller's own seller rules (offline sync of the seller); never other sellers'. */
export const MyDiscountLimitsResponseSchema = named(
  'MyDiscountLimitsResponse',
  z.object({ sellerCode: codeInt().nullable(), rules: z.array(SellerDiscountRuleSchema) }),
);
export type MyDiscountLimitsResponse = z.infer<typeof MyDiscountLimitsResponseSchema>;
