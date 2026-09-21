import { schema, type DbHandle } from '@salesforce/db';
import { isSankhyaGatewayError } from '@salesforce/sankhya';
import { drizzle } from 'drizzle-orm/node-postgres';
import { errorLogFields, type Logger } from '../observability/logger.js';
import type { Clock } from '../platform/tokens.js';
import { TransientJobError } from '../worker/job-contract.js';
import { withEntityLock } from './entity-lock.js';
import { describeSyncFailure, type SyncFailure } from './failure.js';
import {
  MIRROR_ENTITIES,
  MIRROR_SPECS,
  type MirrorEntity,
  type MirrorEntitySpec,
  type MirrorGateway,
} from './mirror-entities.js';
import { applyBatch, countLive, deactivateMissing, hashRows, prepareSeenTable } from './mirror-writer.js';
import { markFailed, markRunning, markSucceeded, type Queryable, type RunStats } from './sync-state.js';

export type MirrorRunOutcome =
  /** The whole snapshot was read and applied. */
  | 'completed'
  /** Another run of the same entity holds the lock; nothing was done (not an error). */
  | 'skipped_locked'
  /** The gateway cannot read this entity yet (NEEDS VALIDATION); recorded as failed/permanent, no read attempted. */
  | 'unsupported';

export interface MirrorRunResult {
  readonly entity: MirrorEntity;
  readonly outcome: MirrorRunOutcome;
  readonly stats: RunStats | null;
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
    const spec = MIRROR_SPECS[entity];

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
    spec: MirrorEntitySpec,
    session: Queryable,
    startedAt: Date,
    signal: AbortSignal | undefined,
  ): Promise<MirrorRunResult> {
    const { gateway, logger } = this.deps;
    const entity = spec.entity;
    const description = gateway.describe();

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
    await prepareSeenTable(session);

    const stats: RunStats = { read: 0, created: 0, updated: 0, reactivated: 0, unchanged: 0, deactivated: 0 };
    const context = {
      gateway,
      description,
      warn: (message: string) => logger.warn({ entity }, message),
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
    await session.transaction(async (tx) => {
      stats.deactivated = await deactivateMissing(tx, spec, stats.read, finishedAt);
      const rowCount = await countLive(tx, spec);
      await markSucceeded(tx, entity, { startedAt, finishedAt, stats, rowCount });
    });

    logger.info({ entity, ...stats }, 'mirror sync completed');
    return { entity, outcome: 'completed', stats };
  }
}
