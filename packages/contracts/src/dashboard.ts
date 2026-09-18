import { z } from 'zod';
import { OrderListItemSchema } from './orders.js';
import { DecimalStringSchema, IsoTimestampSchema, codeInt, named } from './primitives.js';

/** One KPI value. Money and percentages are decimal strings, counts are integers (DATA-3). */
export const MetricValueSchema = named(
  'MetricValue',
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('count'), value: z.number().int().min(0) }),
    z.object({ kind: z.literal('money'), value: DecimalStringSchema }),
    z.object({ kind: z.literal('percent'), value: DecimalStringSchema }),
  ]),
);

export const MetricSchema = named(
  'Metric',
  z.object({
    key: z.string().min(1).max(100),
    label: z.string(),
    value: MetricValueSchema.nullable(),
    description: z.string().nullable(),
  }),
);

export const MetricGroupKeySchema = named(
  'MetricGroupKey',
  z.enum(['portfolio', 'catalog', 'orders', 'credit', 'positivation']),
);

/**
 * A group of KPIs. `demo: true` marks synthetic values from the isolated demonstration provider
 * (rules still unresolved); the UI labels them "Dados de demonstração". Real groups use `false`.
 */
export const MetricGroupSchema = named(
  'MetricGroup',
  z.object({
    key: MetricGroupKeySchema,
    label: z.string(),
    demo: z.boolean(),
    metrics: z.array(MetricSchema),
  }),
);

export const DashboardScopeSchema = named(
  'DashboardScope',
  z.object({
    kind: z.enum(['all', 'sellers']),
    /** Seller codes the figures are limited to; empty when `kind` is `all`. */
    sellerCodes: z.array(codeInt()),
  }),
);

export const DashboardResponseSchema = named(
  'DashboardResponse',
  z.object({
    generatedAt: IsoTimestampSchema,
    scope: DashboardScopeSchema,
    groups: z.array(MetricGroupSchema),
    recentOrders: z.array(OrderListItemSchema),
  }),
);
export type DashboardResponse = z.infer<typeof DashboardResponseSchema>;
export type MetricGroup = z.infer<typeof MetricGroupSchema>;
