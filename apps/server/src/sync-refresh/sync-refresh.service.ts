import { Inject, Injectable } from '@nestjs/common';
import {
  SYNC_REFRESH_ENTITIES,
  SYNC_REFRESH_PHASE_OF,
  canSeeSyncRefreshDetail,
  type SyncRefreshBasic,
  type SyncRefreshView,
  type StartSyncRefreshResponse,
  type SyncRefresh,
  type SyncStatusResponse,
} from '@salesforce/contracts';
import { syncRefresh, syncState, type Database } from '@salesforce/db';
import { desc, eq, inArray } from 'drizzle-orm';
import { AppError } from '../http/app-error.js';
import type { CurrentUser } from '../iam/current-user.js';
import { uuidv7 } from '../platform/ids.js';
import { expireStuckRefreshes, type StoredSyncRefreshStep } from '../sync/sync-refresh-expiry.js';
import { CLOCK, DATABASE, type Clock } from '../platform/tokens.js';

/** A refresh finished less than this long ago is returned instead of starting another one (D-AB B3). */
export const SYNC_REFRESH_COOLDOWN_MS = 60_000;

/** `sync_state` entities that the screens read; the age shown to the seller is the oldest of them. */
const MIRRORED_ENTITIES = SYNC_REFRESH_ENTITIES.filter((entity) => entity !== 'orderStatus');

type Row = typeof syncRefresh.$inferSelect;

/**
 * D-AB B3 (API side). The API never talks to Sankhya (STACK-2): it records the request in `sync_refresh` and the worker
 * runs it. At most one refresh is pending or running (partial unique index), so concurrent clicks share one run.
 */
@Injectable()
export class SyncRefreshService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async start(user: CurrentUser): Promise<StartSyncRefreshResponse> {
    const result = await this.#start(user);
    return canSeeSyncRefreshDetail(user.role) ? result : { ...basicOf(result), reused: result.reused };
  }

  async #start(user: CurrentUser): Promise<SyncRefresh & { reused: boolean }> {
    const now = this.clock();
    // D-AD: a request stuck in pending/running (worker down or restarted) must not block this click.
    await expireStuckRefreshes(this.db, now);
    const [latest] = await this.db.select().from(syncRefresh).orderBy(desc(syncRefresh.requestedAt)).limit(1);
    if (latest !== undefined) {
      const active = latest.status !== 'done';
      const recent = latest.finishedAt !== null && now.getTime() - latest.finishedAt.getTime() < SYNC_REFRESH_COOLDOWN_MS;
      if (active || recent) return { ...(await this.#present(latest)), reused: true };
    }
    const id = uuidv7(now.getTime());
    const steps: StoredSyncRefreshStep[] = SYNC_REFRESH_ENTITIES.map((entity) => ({
      entity,
      status: 'pending',
      rowsRead: null,
      durationMs: null,
      reason: null,
      lastSuccessAt: null,
    }));
    const inserted = await this.db
      .insert(syncRefresh)
      .values({ id, requestedBy: user.accountId, requestedAt: now, steps })
      .onConflictDoNothing()
      .returning();
    const created = inserted[0];
    if (created !== undefined) return { ...(await this.#present(created)), reused: false };
    // Lost the race against a concurrent request: share the active one.
    const [active] = await this.db.select().from(syncRefresh).orderBy(desc(syncRefresh.requestedAt)).limit(1);
    if (active === undefined) throw new AppError('conflict');
    return { ...(await this.#present(active)), reused: true };
  }

  async get(id: string, user: CurrentUser): Promise<SyncRefreshView> {
    const [row] = await this.db.select().from(syncRefresh).where(eq(syncRefresh.id, id)).limit(1);
    if (row === undefined) throw new AppError('not_found');
    const detail = await this.#present(row);
    return canSeeSyncRefreshDetail(user.role) ? detail : basicOf(detail);
  }

  async status(): Promise<SyncStatusResponse> {
    const rows = await this.db
      .select({ at: syncState.lastSuccessAt })
      .from(syncState)
      .where(inArray(syncState.entity, MIRRORED_ENTITIES));
    // What the screens show is as old as the stalest entity read so far.
    const known = rows.flatMap((row) => (row.at === null ? [] : [row.at.getTime()]));
    return { dataAsOf: known.length === 0 ? null : new Date(Math.min(...known)).toISOString() };
  }

  async #present(row: Row): Promise<SyncRefresh> {
    const states = await this.db
      .select({ entity: syncState.entity, at: syncState.lastSuccessAt })
      .from(syncState)
      .where(inArray(syncState.entity, MIRRORED_ENTITIES));
    const lastSuccess = new Map(states.map((state) => [state.entity, state.at]));
    const stored = (Array.isArray(row.steps) ? row.steps : []) as StoredSyncRefreshStep[];
    return {
      id: row.id,
      status: row.status as SyncRefresh['status'],
      requestedAt: row.requestedAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      // D-AF: explicit fields, so the stored record count (rowsRead) can never leak through a spread.
      steps: stored.map((step) => ({
        entity: step.entity,
        status: step.status,
        durationMs: step.durationMs,
        reason: step.reason,
        lastSuccessAt: lastSuccess.get(step.entity)?.toISOString() ?? null,
      })),
    };
  }
}

/**
 * D-AC: the seller's view. Computed on the server from the detail, so the client never receives entity names, counts or
 * technical reasons. Skipped steps (not wired in this installation) count as done and are not a warning.
 */
export function basicOf(detail: SyncRefresh): SyncRefreshBasic {
  const total = detail.steps.length;
  const finished = detail.steps.filter((step) => step.status === 'ok' || step.status === 'failed' || step.status === 'skipped').length;
  const done = detail.status === 'done';
  const current = detail.steps.find((step) => step.status === 'pending' || step.status === 'running');
  return {
    id: detail.id,
    status: detail.status,
    progressPercent: done ? 100 : total === 0 ? 0 : Math.floor((finished / total) * 100),
    phase: done || current === undefined ? 'concluido' : SYNC_REFRESH_PHASE_OF[current.entity],
    finishedAt: detail.finishedAt,
    hasWarnings: detail.steps.some((step) => step.status === 'failed'),
  };
}
