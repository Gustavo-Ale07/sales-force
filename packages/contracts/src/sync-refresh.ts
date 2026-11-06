import { z } from 'zod';
import type { AccountRole } from './auth.js';
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

/** D-AC: only these profiles see entity names, counts and technical reasons. Everyone else gets the basic view. */
export const SYNC_REFRESH_DETAIL_ROLES: readonly AccountRole[] = Object.freeze<AccountRole[]>(['admin', 'manager', 'technical']);

export function canSeeSyncRefreshDetail(role: string): boolean {
  return (SYNC_REFRESH_DETAIL_ROLES as readonly string[]).includes(role);
}

export const SYNC_REFRESH_PHASES = ['cadastros', 'precos', 'pedidos', 'concluido'] as const;
export const SyncRefreshPhaseSchema = named('SyncRefreshPhase', z.enum(SYNC_REFRESH_PHASES));

/** Which seller-visible phase each entity belongs to (the seller never sees the entity itself). */
export const SYNC_REFRESH_PHASE_OF: Record<SyncRefreshEntity, 'cadastros' | 'precos' | 'pedidos'> = {
  configuration: 'cadastros',
  sellers: 'cadastros',
  customers: 'cadastros',
  products: 'cadastros',
  carriers: 'cadastros',
  priceTables: 'precos',
  priceTableVersions: 'precos',
  listPrices: 'precos',
  ipiRates: 'precos',
  openTitles: 'pedidos',
  orderStatus: 'pedidos',
};

/** D-AC: what a seller receives. No entity name, no count, no reason. */
export const SyncRefreshBasicSchema = named(
  'SyncRefreshBasic',
  z.object({
    id: UuidSchema,
    status: SyncRefreshStatusSchema,
    progressPercent: z.number().int().min(0).max(100),
    phase: SyncRefreshPhaseSchema,
    finishedAt: IsoTimestampSchema.nullable(),
    hasWarnings: z.boolean(),
    reused: z.boolean().optional(),
  }),
);
export type SyncRefreshBasic = z.infer<typeof SyncRefreshBasicSchema>;

/** GET /sync/refresh/{id}: detail for manager/admin/technical, basic for the rest (decided on the server by role). */
export const SyncRefreshViewSchema = named('SyncRefreshView', z.union([SyncRefreshSchema, SyncRefreshBasicSchema]));
export type SyncRefreshView = z.infer<typeof SyncRefreshViewSchema>;

/** POST /sync/refresh: reused is true when a refresh was already running or finished less than a minute ago. */
export const StartSyncRefreshResponseSchema = named(
  'StartSyncRefreshResponse',
  z.union([SyncRefreshSchema.extend({ reused: z.boolean() }), SyncRefreshBasicSchema.extend({ reused: z.boolean() })]),
);
export type StartSyncRefreshResponse = z.infer<typeof StartSyncRefreshResponseSchema>;

export const SyncRefreshPathSchema = z.object({ id: UuidSchema });

/** `GET /sync/status`: the age of the data the screens show. `dataAsOf` is the OLDEST last success among the mirrored entities. */
export const SyncStatusResponseSchema = named(
  'SyncStatusResponse',
  z.object({ dataAsOf: IsoTimestampSchema.nullable() }),
);

export type SyncStatusResponse = z.infer<typeof SyncStatusResponseSchema>;
