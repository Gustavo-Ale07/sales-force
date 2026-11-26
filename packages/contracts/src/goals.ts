import { z } from 'zod';
import { DecimalStringSchema, IsoTimestampSchema, codeInt, named } from './primitives.js';

/** Meta x realizado of one dimension (valor or quantidade). `null` = not available, never zero by default. */
export const GoalFigureSchema = named(
  'GoalFigure',
  z.object({
    target: DecimalStringSchema.nullable(),
    realized: DecimalStringSchema.nullable(),
    percent: z.string().nullable(),
  }),
);

export const PositivationFigureSchema = named(
  'PositivationFigure',
  z.object({
    positivated: z.number().int().min(0),
    total: z.number().int().min(0),
    percent: z.string().nullable(),
  }),
);

const GoalRowShape = {
  revenue: GoalFigureSchema,
  quantity: GoalFigureSchema,
  positivation: PositivationFigureSchema.nullable(),
};

export const SellerGoalRowSchema = named(
  'SellerGoalRow',
  z.object({ sellerCode: codeInt(), sellerName: z.string().nullable(), ...GoalRowShape }),
);

/** Goals and positivation of the current month inside the caller scope (RF-GOL-1, RF-GOL-2). No cost, margin or commission. */
export const GoalsResponseSchema = named(
  'GoalsResponse',
  z.object({
    /** `YYYY-MM`. */
    month: z.string().regex(/^\d{4}-\d{2}$/),
    /** Last replacement of the goal mirror / of the sales-history mirror; `null` while never synced. */
    goalsSyncedAt: IsoTimestampSchema.nullable(),
    salesSyncedAt: IsoTimestampSchema.nullable(),
    total: z.object(GoalRowShape),
    /** One row per seller; only for profiles that see a team (manager, admin). */
    bySeller: z.array(SellerGoalRowSchema),
  }),
);
export type GoalsResponse = z.infer<typeof GoalsResponseSchema>;
export type GoalFigure = z.infer<typeof GoalFigureSchema>;
export type PositivationFigure = z.infer<typeof PositivationFigureSchema>;
export type SellerGoalRow = z.infer<typeof SellerGoalRowSchema>;
