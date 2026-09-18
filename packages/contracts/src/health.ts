import { z } from 'zod';
import { IsoTimestampSchema, named } from './primitives.js';

/** Data source of the ERP gateway. `live` is off by default and never wired to spike credentials. */
export const GatewayModeSchema = named('GatewayMode', z.enum(['fake', 'live']));
export type GatewayMode = z.infer<typeof GatewayModeSchema>;

/**
 * Integration state as shown in the UI pill. `degraded` means the ERP is unavailable or a sync is
 * failing while the API itself is fine; it is never a reason to report the API as down.
 */
export const IntegrationSummarySchema = named(
  'IntegrationSummary',
  z.object({
    state: z.enum(['ok', 'degraded', 'not_configured']),
    gatewayMode: GatewayModeSchema,
    lastSuccessAt: IsoTimestampSchema.nullable(),
    failingEntities: z.array(z.string()),
    message: z.string().nullable(),
  }),
);
export type IntegrationSummary = z.infer<typeof IntegrationSummarySchema>;

export const HealthResponseSchema = named('HealthResponse', z.object({ status: z.literal('ok') }));
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

const CheckStatusSchema = z.enum(['ok', 'fail']);

export const ReadyResponseSchema = named(
  'ReadyResponse',
  z.object({
    /** `degraded`: database and migrations are fine but the integration is not (still HTTP 200). */
    status: z.enum(['ready', 'degraded', 'not_ready']),
    checks: z.object({
      database: CheckStatusSchema,
      migrations: z.object({
        status: z.enum(['ok', 'behind', 'ahead', 'unknown']),
        applied: z.string().nullable(),
        expected: z.string().nullable(),
      }),
    }),
    integration: IntegrationSummarySchema,
  }),
);
export type ReadyResponse = z.infer<typeof ReadyResponseSchema>;
