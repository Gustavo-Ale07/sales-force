import { GatewayModeSchema, IsoTimestampSchema } from '@salesforce/contracts';
import { syncState, type Database } from '@salesforce/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

/**
 * Worker liveness record. There is no dedicated table yet, so the worker upserts one reserved row of
 * `sync_state` (entity `worker.heartbeat`): `last_success_at` is the last heartbeat and `cursor`
 * carries the gateway mode. This is how the API learns the gateway mode and whether the worker is
 * alive without ever reading Sankhya settings (STACK-3).
 *
 * ASSUMPTION for the database-engineer / owner: a dedicated `worker_heartbeat` table would be cleaner;
 * this is the least-committing option that needs no migration. Reserved entities (`worker.` prefix)
 * are never listed as mirror sync states and never counted as failing entities.
 */
export const WORKER_HEARTBEAT_ENTITY = 'worker.heartbeat';

/**
 * The heartbeat job is scheduled every minute (the finest cron granularity); a worker that has not
 * beaten for this long is stale, both for the API's integration summary and the worker's own health.
 */
export const HEARTBEAT_STALE_AFTER_MS = 3 * 60_000;
export const RESERVED_ENTITY_PREFIX = 'worker.';

export function isReservedSyncEntity(entity: string): boolean {
  return entity.startsWith(RESERVED_ENTITY_PREFIX);
}

export const WorkerHeartbeatCursorSchema = z.object({
  gatewayMode: GatewayModeSchema,
  startedAt: IsoTimestampSchema,
});
export type WorkerHeartbeatCursor = z.infer<typeof WorkerHeartbeatCursorSchema>;

export async function recordWorkerHeartbeat(
  db: Database,
  cursor: WorkerHeartbeatCursor,
  now: Date,
): Promise<void> {
  await db
    .insert(syncState)
    .values({
      entity: WORKER_HEARTBEAT_ENTITY,
      status: 'succeeded',
      lastSuccessAt: now,
      lastAttemptAt: now,
      cursor,
      lastErrorClass: null,
      lastErrorMessage: null,
    })
    .onConflictDoUpdate({
      target: syncState.entity,
      set: {
        status: 'succeeded',
        lastSuccessAt: now,
        lastAttemptAt: now,
        cursor,
        lastErrorClass: null,
        lastErrorMessage: null,
      },
    });
}

export async function readWorkerHeartbeat(
  db: Database,
): Promise<{ lastBeatAt: Date | null; cursor: WorkerHeartbeatCursor | null } | null> {
  const [row] = await db.select().from(syncState).where(eq(syncState.entity, WORKER_HEARTBEAT_ENTITY));
  if (row === undefined) return null;
  const cursor = WorkerHeartbeatCursorSchema.safeParse(row.cursor);
  return { lastBeatAt: row.lastSuccessAt, cursor: cursor.success ? cursor.data : null };
}
