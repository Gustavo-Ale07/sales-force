import { Inject, Injectable } from '@nestjs/common';
import {
  SYNC_REFRESH_ENTITIES,
  type StartSyncRefreshResponse,
  type SyncRefresh,
  type SyncRefreshStep,
  type SyncStatusResponse,
} from '@salesforce/contracts';
import { syncRefresh, syncState, type Database } from '@salesforce/db';
import { desc, eq, inArray } from 'drizzle-orm';
import { AppError } from '../http/app-error.js';
import type { CurrentUser } from '../iam/current-user.js';
import { uuidv7 } from '../platform/ids.js';
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
    const now = this.clock();
    const [latest] = await this.db.select().from(syncRefresh).orderBy(desc(syncRefresh.requestedAt)).limit(1);
    if (latest !== undefined) {
      const active = latest.status !== 'done';
      const recent = latest.finishedAt !== null && now.getTime() - latest.finishedAt.getTime() < SYNC_REFRESH_COOLDOWN_MS;
      if (active || recent) return { ...(await this.#present(latest)), reused: true };
    }
    const id = uuidv7(now.getTime());
    const steps: SyncRefreshStep[] = SYNC_REFRESH_ENTITIES.map((entity) => ({
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

  async get(id: string): Promise<SyncRefresh> {
    const [row] = await this.db.select().from(syncRefresh).where(eq(syncRefresh.id, id)).limit(1);
    if (row === undefined) throw new AppError('not_found');
    return this.#present(row);
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
    const stored = (Array.isArray(row.steps) ? row.steps : []) as SyncRefreshStep[];
    return {
      id: row.id,
      status: row.status as SyncRefresh['status'],
      requestedAt: row.requestedAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      steps: stored.map((step) => ({
        ...step,
        lastSuccessAt: lastSuccess.get(step.entity)?.toISOString() ?? null,
      })),
    };
  }
}
