import { z } from 'zod';
import { IsoTimestampSchema, UuidSchema, named } from './primitives.js';

/**
 * D-AB B3: "Atualizar dados" reads Sankhya on demand. The API never talks to Sankhya (STACK-2): it records the request in
 * `sync_refresh` and the worker runs the read-only steps in this order. Counts and masked reasons only; never row content.
 */
export const SYNC_REFRESH_ENTITIES = [
  'configuration',
  'sellers',
  'customers',
  'products',
  'priceTables',
  'priceTableVersions',
  'listPrices',
  'carriers',
  'ipiRates',
  'openTitles',
  'orderStatus',
] as const;

export const SyncRefreshEntitySchema = named('SyncRefreshEntity', z.enum(SYNC_REFRESH_ENTITIES));
export type SyncRefreshEntity = z.infer<typeof SyncRefreshEntitySchema>;

export const SyncRefreshStepStatusSchema = named('SyncRefreshStepStatus', z.enum(['pending', 'running', 'ok', 'failed', 'skipped']));

export const SyncRefreshStepSchema = named(
  'SyncRefreshStep',
  z.object({
    entity: SyncRefreshEntitySchema,
    status: SyncRefreshStepStatusSchema,
    rowsRead: z.number().int().min(0).nullable(),
    durationMs: z.number().int().min(0).nullable(),
    /** Masked, secret-free reason of a failed or skipped step (D-Q). */
    reason: z.string().max(500).nullable(),
    /** Last successful read of this entity (so a failed step can say how old the data it kept is). */
    lastSuccessAt: IsoTimestampSchema.nullable(),
  }),
);

export type SyncRefreshStep = z.infer<typeof SyncRefreshStepSchema>;

export const SyncRefreshStatusSchema =named('SyncRefreshStatus', z.enum(['pending', 'running', 'done']));

export const SyncRefreshSchema = named(
  'SyncRefresh',
  z.object({
    id: UuidSchema,
    status: SyncRefreshStatusSchema,
    requestedAt: IsoTimestampSchema,
    startedAt: IsoTimestampSchema.nullable(),
    finishedAt: IsoTimestampSchema.nullable(),
    steps: z.array(SyncRefreshStepSchema),
  }),
);
export type SyncRefresh = z.infer<typeof SyncRefreshSchema>;

/** `POST /sync/refresh`: `reused` is true when a refresh was already running or finished less than a minute ago. */
export const StartSyncRefreshResponseSchema = named(
  'StartSyncRefreshResponse',
  SyncRefreshSchema.extend({ reused: z.boolean() }),
);

export type StartSyncRefreshResponse = z.infer<typeof StartSyncRefreshResponseSchema>;

export const SyncRefreshPathSchema = z.object({ id: UuidSchema });

/** `GET /sync/status`: the age of the data the screens show. `dataAsOf` is the OLDEST last success among the mirrored entities. */
export const SyncStatusResponseSchema = named(
  'SyncStatusResponse',
  z.object({ dataAsOf: IsoTimestampSchema.nullable() }),
);

export type SyncStatusResponse = z.infer<typeof SyncStatusResponseSchema>;
