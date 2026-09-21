import { GatewayModeSchema } from '@salesforce/contracts';
import type { DbHandle } from '@salesforce/db';
import type { Secret } from '@salesforce/sankhya';
import { PgBoss } from 'pg-boss';
import type { Logger } from '../observability/logger.js';
import type { Clock } from '../platform/tokens.js';
import {
  recordWorkerHeartbeat,
  type WorkerHeartbeatCursor,
} from '../platform/worker-heartbeat.js';
import { startHealthServer, WorkerHealth, type HealthServer } from './health.js';
import type { JobHandler } from './job-contract.js';
import { createBatchHandler } from './job-runner.js';
import { SyncHeartbeatJob } from './jobs/sync-heartbeat.job.js';
import { QUEUE_NAMES, QUEUE_REGISTRY, type QueueSpec } from './queues.js';

export const QUEUE_INSTALL_HINT =
  'Run the one-shot queue installation before starting the worker (pnpm db:queue:install). ' +
  'Queue tables are installed like migrations, never at worker start (DATA-2).';

export class WorkerStartError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WorkerStartError';
  }
}

export interface WorkerRuntimeOptions {
  readonly databaseUrl: Secret;
  readonly heartbeatCron: string;
  readonly shutdownTimeoutMs: number;
  /** Loopback health endpoint; `null` disables it (tests). Port 0 picks a free port. */
  readonly health: { readonly host: string; readonly port: number } | null;
  readonly gatewayMode: string;
  /** pg-boss connection pool size (default 5). */
  readonly poolMax?: number;
  /** Idle poll interval of every queue worker, in seconds (>= 0.5, default 2). */
  readonly pollingIntervalSeconds?: number;
}

export interface WorkerRuntimeDeps {
  readonly logger: Logger;
  readonly db: DbHandle;
  readonly now: Clock;
  readonly options: WorkerRuntimeOptions;
  /** Queues that must exist (default: the registry). */
  readonly queues?: readonly QueueSpec[];
  /** Handlers registered in addition to the built-in ones (tests, later modules). */
  readonly extraHandlers?: readonly JobHandler<unknown>[];
}

/**
 * The Worker process runtime (STACK-2): pg-boss workers for every registered handler, the scheduled
 * `sync.heartbeat`, the loopback health endpoint and graceful shutdown. It never runs migrations or
 * installs queue tables (DATA-2): a missing pg-boss schema or queue stops the start with an
 * actionable message. It never writes to Sankhya (SNK-4): no handler here touches the gateway.
 */
export class WorkerRuntime {
  readonly health: WorkerHealth;
  #boss: PgBoss | undefined;
  #healthServer: HealthServer | undefined;
  #started = false;

  constructor(private readonly deps: WorkerRuntimeDeps) {
    this.health = new WorkerHealth(deps.now);
  }

  /** Port of the health endpoint once started (undefined when disabled). */
  get healthPort(): number | undefined {
    return this.#healthServer?.port;
  }

  get boss(): PgBoss {
    if (this.#boss === undefined) throw new WorkerStartError('The worker is not started.');
    return this.#boss;
  }

  async start(): Promise<void> {
    if (this.#started) throw new WorkerStartError('The worker is already started.');
    const { logger, options } = this.deps;
    const queues = this.deps.queues ?? QUEUE_REGISTRY;

    const boss = new PgBoss({
      connectionString: options.databaseUrl.reveal(),
      application_name: 'salesforce-worker',
      max: options.poolMax ?? 5,
      // DATA-2: the pg-boss schema is installed by the one-shot `queue:install`, never here.
      migrate: false,
      createSchema: false,
    });
    boss.on('error', (error) => logger.error({ err: error }, 'pg-boss error'));
    this.#boss = boss;

    try {
      await boss.start();
    } catch (cause) {
      this.#boss = undefined;
      throw new WorkerStartError(`Cannot start the job queue (pg-boss). ${QUEUE_INSTALL_HINT}`, { cause });
    }

    try {
      for (const spec of queues) {
        if ((await boss.getQueue(spec.name)) === null) {
          throw new WorkerStartError(`Queue "${spec.name}" does not exist. ${QUEUE_INSTALL_HINT}`);
        }
      }

      const heartbeatCursor: WorkerHeartbeatCursor = {
        gatewayMode: GatewayModeSchema.parse(options.gatewayMode),
        startedAt: this.deps.now().toISOString(),
      };
      const heartbeat = new SyncHeartbeatJob(this.deps.db.db, heartbeatCursor, (at) => this.health.recordBeat(at));
      const handlers: readonly JobHandler<unknown>[] = [heartbeat, ...(this.deps.extraHandlers ?? [])];

      for (const handler of handlers) {
        await boss.work(
          handler.queue,
          {
            perJobResults: true,
            batchSize: 5,
            localConcurrency: 1,
            pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2,
          },
          createBatchHandler(handler, { logger, now: this.deps.now }),
        );
        logger.info({ queue: handler.queue }, 'job handler registered');
      }

      // Idempotent upsert: a changed HEARTBEAT_CRON replaces the stored schedule.
      await boss.schedule(QUEUE_NAMES.syncHeartbeat, options.heartbeatCron, {});

      this.health.markStarted();
      // First beat right away, so the API sees the worker (and its gateway mode) without waiting a minute.
      const firstBeat = this.deps.now();
      await recordWorkerHeartbeat(this.deps.db.db, heartbeatCursor, firstBeat);
      this.health.recordBeat(firstBeat);

      if (options.health !== null) {
        this.#healthServer = await startHealthServer({ ...options.health, health: this.health, logger });
      }
    } catch (error) {
      await this.#stopBoss(false);
      throw error;
    }

    this.#started = true;
    logger.info({ gatewayMode: options.gatewayMode, heartbeatCron: options.heartbeatCron }, 'worker started');
  }

  /** Graceful shutdown: stop taking jobs, let running ones finish (bounded), then close pg-boss. */
  async stop(): Promise<void> {
    this.health.markStopping();
    await this.#healthServer?.close();
    this.#healthServer = undefined;
    await this.#stopBoss(true);
    this.#started = false;
    this.deps.logger.info('worker stopped');
  }

  async #stopBoss(graceful: boolean): Promise<void> {
    const boss = this.#boss;
    this.#boss = undefined;
    if (boss === undefined) return;
    try {
      await boss.stop({ graceful, timeout: this.deps.options.shutdownTimeoutMs, close: true });
    } catch (error) {
      this.deps.logger.error({ err: error }, 'error while stopping pg-boss');
    }
  }
}
