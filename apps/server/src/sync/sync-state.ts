import type { schema } from '@salesforce/db';
import { syncState } from '@salesforce/db';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { SyncFailure } from './failure.js';
import type { MirrorEntity } from './mirror-entities.js';

/** A Drizzle database or transaction over the application schema. */
export type Queryable = PgDatabase<NodePgQueryResultHKT, typeof schema>;

/** Counters of one run. Row content is never recorded, only counts. */
export const RunStatsSchema = z.object({
  read: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  reactivated: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  deactivated: z.number().int().nonnegative(),
});
export type RunStats = z.infer<typeof RunStatsSchema>;

/**
 * `sync_state.cursor` of a mirror entity. Every run is a FULL snapshot compared by content hash
 * (spike §9.33 item 2: full snapshot + hash diff is the measured-viable strategy; `DTALTER`
 * incremental cursors are NEEDS VALIDATION), so there is no resume position: an interrupted run is
 * simply repeated and the rows it already wrote are skipped by hash. Lag is derived
 * (`now - last_success_at`), it is not stored.
 */
export const MirrorCursorSchema = z.object({
  strategy: z.literal('full_snapshot'),
  lastRun: z.object({
    startedAt: z.string(),
    finishedAt: z.string(),
    durationMs: z.number().int().nonnegative(),
    stats: RunStatsSchema,
  }),
});
export type MirrorCursor = z.infer<typeof MirrorCursorSchema>;

/** Marks the start of a run. `last_success_at`, `cursor` and the previous error stay as they were. */
export async function markRunning(db: Queryable, entity: MirrorEntity, at: Date): Promise<void> {
  await db
    .insert(syncState)
    .values({ entity, status: 'running', lastAttemptAt: at })
    .onConflictDoUpdate({ target: syncState.entity, set: { status: 'running', lastAttemptAt: at } });
}

export async function markSucceeded(
  db: Queryable,
  entity: MirrorEntity,
  input: { startedAt: Date; finishedAt: Date; stats: RunStats; rowCount: number },
): Promise<void> {
  const cursor: MirrorCursor = {
    strategy: 'full_snapshot',
    lastRun: {
      startedAt: input.startedAt.toISOString(),
      finishedAt: input.finishedAt.toISOString(),
      durationMs: Math.max(0, input.finishedAt.getTime() - input.startedAt.getTime()),
      stats: input.stats,
    },
  };
  const values = {
    status: 'succeeded',
    lastSuccessAt: input.finishedAt,
    lastAttemptAt: input.startedAt,
    lastFullReconcileAt: input.finishedAt,
    cursor,
    rowCount: input.rowCount,
    lastErrorClass: null,
    lastErrorMessage: null,
  };
  await db
    .insert(syncState)
    .values({ entity, ...values })
    .onConflictDoUpdate({ target: syncState.entity, set: values });
}

/** Records a failed run. `last_success_at`, `cursor` and `row_count` keep describing the last good run. */
export async function markFailed(db: Queryable, entity: MirrorEntity, at: Date, failure: SyncFailure): Promise<void> {
  const values = { status: 'failed', lastAttemptAt: at, lastErrorClass: failure.errorClass, lastErrorMessage: failure.message };
  await db
    .insert(syncState)
    .values({ entity, ...values })
    .onConflictDoUpdate({ target: syncState.entity, set: values });
}
