import { z } from 'zod';
import { IsoTimestampSchema, UuidSchema, codeInt, named, sellerCodeInt } from './primitives.js';

/**
 * Force configuration (owner ruling 2026-11-27): every setting lives in the Force database and is edited on the site
 * (admin and manager only). The ERP is only a data source.
 */

/** `GET /force-config` and the result of `PUT /force-config`. */
export const ForceSettingsSchema = named(
  'ForceSettings',
  z.object({
    /** Days the app may stay without a synchronization (1 to 60). */
    maxDaysWithoutSync: z.number().int().min(1).max(60),
    /** Price table of a new customer when none is chosen; must exist in the ERP price-table mirror. */
    defaultPriceTableCode: codeInt(),
    updatedAt: IsoTimestampSchema,
  }),
);
export type ForceSettings = z.infer<typeof ForceSettingsSchema>;

/** `PUT /force-config`: both fields, always. Audited (previous and new values). */
export const UpdateForceSettingsRequestSchema = named(
  'UpdateForceSettingsRequest',
  z.strictObject({
    maxDaysWithoutSync: z.number().int().min(1).max(60),
    defaultPriceTableCode: codeInt(),
  }),
);
export type UpdateForceSettingsRequest = z.infer<typeof UpdateForceSettingsRequestSchema>;

/* ---------- per-seller discount rules (kept in the Force database; managed on the site) ---------- */

/** What the rule applies to: one product, a subgroup, a group, or `none` = the seller's general rule. */
export const DiscountRuleTargetKindSchema = named('DiscountRuleTargetKind', z.enum(['product', 'subgroup', 'group', 'none']));
export type DiscountRuleTargetKind = z.infer<typeof DiscountRuleTargetKindSchema>;

/** Maximum percent: 0 to 100, up to four decimals, as text. */
export const DiscountRulePercentSchema = z.string().regex(/^(100(\.0+)?|\d{1,2}(\.\d{1,4})?)$/);

export const SellerDiscountRuleRecordSchema = named(
  'SellerDiscountRuleRecord',
  z.object({
    id: UuidSchema,
    sellerCode: sellerCodeInt(),
    /** Seller name from the ERP mirror; null when the seller is not mirrored. */
    sellerName: z.string().nullable(),
    targetKind: DiscountRuleTargetKindSchema,
    /** Product or group code; null for `none`. */
    targetCode: codeInt().nullable(),
    /** Product description or group name from the mirror; null for `none` or when not mirrored. */
    targetName: z.string().nullable(),
    maxPercent: DiscountRulePercentSchema,
    updatedAt: IsoTimestampSchema,
  }),
);
export type SellerDiscountRuleRecord = z.infer<typeof SellerDiscountRuleRecordSchema>;

/** `GET /seller-discount-rules?sellerCode=`: all rules, or those of one seller. Ordered by seller, then kind, then code. */
export const SellerDiscountRulesQuerySchema = z.object({ sellerCode: z.coerce.number().int().min(1).optional() });
export const SellerDiscountRulesResponseSchema = named(
  'SellerDiscountRulesResponse',
  z.object({ items: z.array(SellerDiscountRuleRecordSchema) }),
);
export type SellerDiscountRulesResponse = z.infer<typeof SellerDiscountRulesResponseSchema>;

/** `POST /seller-discount-rules`: `targetCode` is required for product/subgroup/group and must be null for `none`. 409 when the same (seller, kind, target) exists. */
export const CreateSellerDiscountRuleRequestSchema = named(
  'CreateSellerDiscountRuleRequest',
  z
    .strictObject({
      sellerCode: sellerCodeInt(),
      targetKind: DiscountRuleTargetKindSchema,
      targetCode: z.number().int().min(1).nullable(),
      maxPercent: DiscountRulePercentSchema,
    })
    .refine((v) => (v.targetKind === 'none') === (v.targetCode === null), { message: 'targetCode', path: ['targetCode'] }),
);
export type CreateSellerDiscountRuleRequest = z.infer<typeof CreateSellerDiscountRuleRequestSchema>;

/** `PUT /seller-discount-rules/{id}`: only the percent changes (another target is a delete plus a create). */
export const UpdateSellerDiscountRuleRequestSchema = named(
  'UpdateSellerDiscountRuleRequest',
  z.strictObject({ maxPercent: DiscountRulePercentSchema }),
);
export type UpdateSellerDiscountRuleRequest = z.infer<typeof UpdateSellerDiscountRuleRequestSchema>;

export const SellerDiscountRulePathSchema = z.object({ id: UuidSchema });
