import { schema, type DbHandle } from '@salesforce/db';
import { isSankhyaGatewayError, SankhyaGatewayError, type ReadScope } from '@salesforce/sankhya';
import { drizzle } from 'drizzle-orm/node-postgres';
import { errorLogFields, type Logger } from '../observability/logger.js';
import type { Clock } from '../platform/tokens.js';
import { TransientJobError } from '../worker/job-contract.js';
import { withEntityLock } from './entity-lock.js';
import { MirrorScopeUnavailableError } from './mirror-scope.js';
import { describeSyncFailure, type SyncFailure } from './failure.js';
import { sql } from 'drizzle-orm';
import {
  MIRROR_ENTITIES,
  MIRROR_SPECS,
  SNAPSHOT_REPLACE_SPECS,
  isSnapshotReplaceEntity,
  type MirrorEntity,
  type MirrorEntitySpec,
  type MirrorGateway,
  type MirrorReadContext,
  type SnapshotReplaceSpec,
} from './mirror-entities.js';
import type { SalesHistorySyncConfig } from './sales-history-config.js';
import { applyBatch, countLive, deactivateMissing, hashRows, prepareSeenTable } from './mirror-writer.js';
import { evaluateMobilityGuard } from '@salesforce/domain';
import { markFailed, markRunning, markSucceeded, type MobilityRun, type Queryable, type RunStats } from './sync-state.js';

export type MirrorRunOutcome =
  /** The whole snapshot was read and applied. */
  | 'completed'
  /** Another run of the same entity holds the lock; nothing was done (not an error). */
  | 'skipped_locked'
  /** Sales history only: no sale TOP is configured (CFG-3), so nothing is read and nothing is recorded. Not an error. */
  | 'not_configured'
  /** The gateway cannot read this entity yet (NEEDS VALIDATION); recorded as failed/permanent, no read attempted. */
  | 'unsupported';

export interface MirrorRunResult {
  readonly entity: MirrorEntity;
  readonly outcome: MirrorRunOutcome;
  readonly stats: RunStats | null;
  /** D-V: rows left out per eligibility criterion (customers, carriers); absent otherwise. */
  readonly excluded?: Readonly<Record<string, number>>;
  /** Products only (owner ruling 2026-11-13): AD_MOBILIDADE counts and whether the anti-empty guard kept the previous base. */
  readonly mobility?: MobilityRun;
}

export interface MirrorRunFailure {
  readonly entity: MirrorEntity;
  readonly failure: SyncFailure;
}

export interface MirrorSyncDeps {
  readonly db: DbHandle;
  /** The read side of the gateway only: the sync has no way to call `submitOrder` (SNK-4, SNK-6). */
  readonly gateway: MirrorGateway;
  readonly logger: Logger;
  readonly now: Clock;
  /**
   * Derives the read scope from the current installation configuration before each run. Absent = unscoped
   * reads (fake/demo and tests). A rejection fails the run: it never falls back to an unscoped read.
   */
  readonly readScope?: () => Promise<ReadScope>;
  /** Sales-history TOP/status/window configuration (CFG-3). Absent or `null` = the sales-history entities are not configured. */
  readonly salesHistory?: SalesHistorySyncConfig | null;
}

const REPLACE_CHUNK_ROWS = 500;

function isReplaceSpec(spec: MirrorEntitySpec | SnapshotReplaceSpec): spec is SnapshotReplaceSpec {
  return isSnapshotReplaceEntity(spec.entity);
}

/** Serializes async work inside one process. */
class ProcessMutex {
  #tail: Promise<unknown> = Promise.resolve();

  run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(work, work);
    this.#tail = result.catch(() => undefined);
    return result;
  }
}

/**
 * Mirror synchronization (RF-SNK-1/2/8 subset, WP 0.8): per entity, reads a FULL snapshot from the
 * gateway and reconciles it with the `erp_*` table by content hash.
 *
 * - Read only. The gateway is used through `MirrorGateway` (read port); no write path exists here.
 * - Concurrency: a PostgreSQL session advisory lock per entity (two workers, or a worker and the CLI,
 *   never run one entity at once; the loser skips), and an in-process mutex so the worker's parallel
 *   queue workers never issue simultaneous ERP requests (the request limits are unmeasured, spike §5).
 * - Batches: each gateway batch is applied in its own transaction (bounded memory and lock time).
 * - Deactivation: only after the WHOLE snapshot was read without error, in one transaction with the
 *   sync_state success record. A failed or partial read never deactivates anything.
 * - Idempotent and resumable: repeating a run changes nothing that is already current (hash-diff);
 *   after an interruption the next run simply repeats the snapshot.
 * - `sync_state`: `running` at the start; `succeeded` (with last success time, counters and live row
 *   count) or `failed` (class + secret-free message, previous success data kept). `/ready` reads it.
 */
export class MirrorSyncService {
  readonly #mutex = new ProcessMutex();

  constructor(private readonly deps: MirrorSyncDeps) {}

  /** Runs one entity. Throws the original error after recording it in `sync_state`. */
  run(entity: MirrorEntity, options: { signal?: AbortSignal } = {}): Promise<MirrorRunResult> {
    return this.#mutex.run(() => this.#runLocked(entity, options.signal));
  }

  /** Runs several entities one after the other; a failure of one does not stop the others. */
  async runAll(
    entities: readonly MirrorEntity[] = MIRROR_ENTITIES,
    options: { signal?: AbortSignal } = {},
  ): Promise<{ results: MirrorRunResult[]; failures: MirrorRunFailure[] }> {
    const results: MirrorRunResult[] = [];
    const failures: MirrorRunFailure[] = [];
    for (const entity of entities) {
      try {
        results.push(await this.run(entity, options));
      } catch (error) {
        failures.push({ entity, failure: describeSyncFailure(error) });
      }
    }
    return { results, failures };
  }

  async #runLocked(entity: MirrorEntity, signal: AbortSignal | undefined): Promise<MirrorRunResult> {
    const { db, logger } = this.deps;
    const spec = isSnapshotReplaceEntity(entity) ? SNAPSHOT_REPLACE_SPECS[entity] : MIRROR_SPECS[entity];

    const locked = await withEntityLock(db.pool, entity, async (client) => {
      const session = drizzle(client, { schema });
      const startedAt = this.deps.now();
      try {
        return await this.#execute(spec, session, startedAt, signal);
      } catch (raised) {
        // A cancelled job (expiry, shutdown) is temporary: the next run repeats the snapshot.
        const error: unknown =
          signal?.aborted === true && !isSankhyaGatewayError(raised)
            ? new TransientJobError('The mirror run was cancelled before it finished.', { cause: raised })
            : raised;
        const failure = describeSyncFailure(error);
        logger.warn(
          { entity, errorClass: failure.errorClass, errorCode: failure.errorCode, retry: failure.retry },
          'mirror sync failed',
        );
        // Recorded on a fresh pooled connection: the locked session may be the very thing that failed.
        await markFailed(this.deps.db.db, entity, this.deps.now(), failure).catch((recordError: unknown) =>
          logger.error({ ...errorLogFields(recordError), entity }, 'could not record the failure in sync_state'),
        );
        throw error;
      }
    });

    if (!locked.acquired) {
      logger.info({ entity }, 'mirror sync skipped: another run of this entity is in progress');
      return { entity, outcome: 'skipped_locked', stats: null };
    }
    return locked.value;
  }

  async #execute(
    spec: MirrorEntitySpec | SnapshotReplaceSpec,
    session: Queryable,
    startedAt: Date,
    signal: AbortSignal | undefined,
  ): Promise<MirrorRunResult> {
    const { gateway, logger } = this.deps;
    const entity = spec.entity;
    const description = gateway.describe();

    // Not configured is a normal state of an installation that does not use sales history: no read, no sync_state row.
    if (isSnapshotReplaceEntity(entity) && (this.deps.salesHistory ?? null) === null) {
      logger.info({ entity }, 'mirror sync skipped: the sales-history TOPs are not configured');
      return { entity, outcome: 'not_configured', stats: null };
    }

    const unsupported = spec.requires.find((read) => description.capabilities.reads[read] === 'not_implemented');
    if (unsupported !== undefined) {
      const failure: SyncFailure = {
        errorClass: 'permanent',
        errorCode: 'not_implemented',
        message: `not_implemented: the gateway cannot read "${unsupported}" yet (NEEDS VALIDATION, docs/sankhya-spike.md §9.42). The entity is not mirrored.`,
        retry: false,
      };
      // Recorded, not thrown: the condition is permanent and identical on every tick, so it must
      // show in the integration status without filling the dead-letter queue.
      await markFailed(session, entity, startedAt, failure);
      logger.warn({ entity, read: unsupported }, 'mirror sync not possible: gateway read not implemented');
      return { entity, outcome: 'unsupported', stats: null };
    }

    await markRunning(session, entity, startedAt);
    if (isReplaceSpec(spec)) return this.#replaceSnapshot(spec, session, startedAt, signal);
    await prepareSeenTable(session);

    const stats: RunStats = { read: 0, created: 0, updated: 0, reactivated: 0, unchanged: 0, deactivated: 0 };
    const scope = this.deps.readScope === undefined ? undefined : await this.deps.readScope();
    // Fail closed against a real ERP: an absent scope, or one without the price-table list, would read
    // every table (including internal/cost tables) instead of the configured mobile ones.
    if (
      description.mode === 'live' &&
      (scope === undefined ||
        scope.priceTableCodes === undefined ||
        scope.priceTableCodes.length === 0 ||
        (scope.products?.usageValues ?? []).length === 0)
    ) {
      throw new MirrorScopeUnavailableError(
        'Live mirror requires a configured read scope with non-empty products.sellableUsageValues and pricing.mobilePriceTableCodes; refusing an unscoped read.',
      );
    }
    const excluded: Record<string, number> = {};
    const context: MirrorReadContext = {
      gateway,
      description,
      ...(scope === undefined ? {} : { scope }),
      warn: (message: string) => logger.warn({ entity }, message),
      excluded: (_entity: string, counts: Readonly<Record<string, number>>) => {
        for (const [criterion, n] of Object.entries(counts)) excluded[criterion] = (excluded[criterion] ?? 0) + n;
      },
      ...(signal === undefined ? {} : { signal }),
    };

    for await (const batch of spec.read(context)) {
      signal?.throwIfAborted();
      const rows = hashRows(batch);
      const counts = await session.transaction((tx) => applyBatch(tx, spec, rows, startedAt));
      stats.read += rows.length;
      stats.created += counts.created;
      stats.updated += counts.updated;
      stats.reactivated += counts.reactivated;
      stats.unchanged += counts.unchanged;
    }

    // The iteration finished without throwing: the snapshot is complete.
    const finishedAt = this.deps.now();
    const hasExcluded = Object.keys(excluded).length > 0;
    // Anti-empty-catalog guard (owner ruling 2026-11-13): when AD_MOBILIDADE would hide more than 90 % of the products (or all),
    // the previous base is kept: nothing is deactivated, the run is recorded with the counts and a warning.
    let mobility: MobilityRun | undefined;
    if (entity === 'products' && excluded['mobility'] !== undefined) {
      const tally = { visible: stats.read, hidden: excluded['mobility'] };
      const verdict = evaluateMobilityGuard(tally);
      mobility = { ...tally, keptPrevious: verdict.keepPrevious };
      if (verdict.keepPrevious) {
        logger.warn({ entity, ...tally, reason: verdict.reason }, 'mobility guard: the previous product base was kept (avise o TI: confira AD_MOBILIDADE nos produtos)');
      }
    }
    await session.transaction(async (tx) => {
      stats.deactivated = mobility?.keptPrevious === true ? 0 : await deactivateMissing(tx, spec, stats.read, finishedAt);
      const rowCount = await countLive(tx, spec);
      await markSucceeded(tx, entity, {
        startedAt,
        finishedAt,
        stats,
        rowCount,
        ...(hasExcluded ? { excluded } : {}),
        ...(mobility === undefined ? {} : { mobility }),
      });
    });

    logger.info({ entity, ...stats, ...(hasExcluded ? { excluded } : {}) }, 'mirror sync completed');
    return { entity, outcome: 'completed', stats, ...(hasExcluded ? { excluded } : {}), ...(mobility === undefined ? {} : { mobility }) };
  }

  /**
   * Atomic snapshot replacement (sales history). The whole window is read into memory FIRST (the gateway is never called inside
   * a database transaction); only when the read finished without error is the table emptied and refilled in ONE transaction
   * together with the `sync_state` success record. A failed or cancelled run changes nothing, so readers always see one complete
   * snapshot. Fails closed on an empty snapshot while rows exist (a broken read, not a real "no sales").
   */
  async #replaceSnapshot(
    spec: SnapshotReplaceSpec,
    session: Queryable,
    startedAt: Date,
    signal: AbortSignal | undefined,
  ): Promise<MirrorRunResult> {
    const { gateway, logger } = this.deps;
    const entity = spec.entity;
    const salesHistory = this.deps.salesHistory ?? undefined;
    const rows: Readonly<Record<string, unknown>>[] = [];
    const context: MirrorReadContext = {
      gateway,
      description: gateway.describe(),
      warn: (message: string) => logger.warn({ entity }, message),
      ...(salesHistory === undefined ? {} : { salesHistory }),
      ...(signal === undefined ? {} : { signal }),
    };
    for await (const batch of spec.read(context)) {
      signal?.throwIfAborted();
      for (const row of batch) rows.push(row);
    }

    const finishedAt = this.deps.now();
    await session.transaction(async (tx) => {
      const existing = ((await tx.execute(sql`select count(*)::int as n from ${spec.table}`)).rows[0] as { n: number } | undefined)?.n ?? 0;
      if (rows.length === 0 && existing > 0) {
        throw new SankhyaGatewayError('validation', {
          code: 'empty_snapshot',
          message: `${entity}: the source returned no rows while the mirror holds rows. The mirror was not changed; check the source and the TOP configuration before repeating the run.`,
        });
      }
      await tx.delete(spec.table);
      for (let offset = 0; offset < rows.length; offset += REPLACE_CHUNK_ROWS) {
        const chunk = rows.slice(offset, offset + REPLACE_CHUNK_ROWS).map((row) => ({ ...row, syncedAt: finishedAt }));
        await tx.insert(spec.table).values(chunk as never);
      }
      const stats: RunStats = { read: rows.length, created: rows.length, updated: 0, reactivated: 0, unchanged: 0, deactivated: 0 };
      await markSucceeded(tx, entity, { startedAt, finishedAt, stats, rowCount: rows.length });
    });

    logger.info({ entity, rows: rows.length }, 'mirror sync completed (snapshot replaced)');
    return { entity, outcome: 'completed', stats: { read: rows.length, created: rows.length, updated: 0, reactivated: 0, unchanged: 0, deactivated: 0 } };
  }
}
