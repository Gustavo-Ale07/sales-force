import type { SyncRefreshStep } from '@salesforce/contracts';
import { syncRefresh, type Database } from '@salesforce/db';
import { and, eq, inArray } from 'drizzle-orm';

/** A step as stored in `sync_refresh.steps`: the public step plus the record count, which stays in the database for diagnosis and never leaves through the API (D-AF). */
export type StoredSyncRefreshStep = SyncRefreshStep & { rowsRead: number | null };

/** A request the worker never picked up for this long is dead (worker down). */
export const SYNC_REFRESH_PENDING_EXPIRY_MS = 2 * 60_000;
/** A run that advanced nothing (no claim, no step write) for this long is dead (worker restarted mid-run). */
export const SYNC_REFRESH_RUNNING_EXPIRY_MS = 5 * 60_000;
/** Masked reason shown to everybody; the technical cause stays in the logs. */
export const SYNC_REFRESH_EXPIRED_REASON = 'O serviço de atualização não respondeu';

/**
 * D-AD: closes `sync_refresh` rows that stay pending/running forever, so the partial unique index (one active run) and
 * the 60 s cooldown never hold the next click hostage. Called by the worker poller and by the API on `POST /sync/refresh`.
 * An expired run becomes `done` with its unfinished steps failed (the dialogs already read that as "avisos"); its
 * `finishedAt` is stamped with the last moment it was alive, never "now", so the cooldown does not apply to it.
 * A healthy slow run is safe: every step write moves `progress_at`.
 */
export async function expireStuckRefreshes(db: Database, now: Date): Promise<number> {
  const rows = await db.select().from(syncRefresh).where(inArray(syncRefresh.status, ['pending', 'running']));
  let expired = 0;
  for (const row of rows) {
    const alive = row.status === 'pending' ? row.requestedAt : (row.progressAt ?? row.startedAt ?? row.requestedAt);
    const limit = row.status === 'pending' ? SYNC_REFRESH_PENDING_EXPIRY_MS : SYNC_REFRESH_RUNNING_EXPIRY_MS;
    if (now.getTime() - alive.getTime() <= limit) continue;
    const steps = (row.steps as StoredSyncRefreshStep[]).map((step) =>
      step.status === 'pending' || step.status === 'running' ? { ...step, status: 'failed' as const, reason: SYNC_REFRESH_EXPIRED_REASON } : step,
    );
    // Guarded by the observed status: a run that finished meanwhile is left alone.
    const closed = await db
      .update(syncRefresh)
      .set({ status: 'done', finishedAt: alive, steps })
      .where(and(eq(syncRefresh.id, row.id), eq(syncRefresh.status, row.status)))
      .returning({ id: syncRefresh.id });
    expired += closed.length;
  }
  return expired;
}
