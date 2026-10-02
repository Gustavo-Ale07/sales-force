import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLogger } from '../../src/observability/logger.js';
import { readWorkerHeartbeat } from '../../src/platform/worker-heartbeat.js';
import { PermanentJobError, TransientJobError, type JobHandler } from '../../src/worker/job-contract.js';
import { installQueues } from '../../src/worker/queue-installer.js';
import { QUEUE_NAMES, QUEUE_REGISTRY, type QueueSpec } from '../../src/worker/queues.js';
import { WorkerRuntime, WorkerStartError } from '../../src/worker/runtime.js';
import { captureLogs, createMigratedDatabase, startPostgres, type MigratedDatabase, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

const PERMANENT_QUEUE = 'test.permanent';
const TRANSIENT_QUEUE = 'test.transient';

const TEST_QUEUES: readonly QueueSpec[] = [
  ...QUEUE_REGISTRY,
  { name: PERMANENT_QUEUE, options: { retryLimit: 3, retryDelay: 1, deadLetter: QUEUE_NAMES.deadLetter } },
  { name: TRANSIENT_QUEUE, options: { retryLimit: 1, retryDelay: 1, deadLetter: QUEUE_NAMES.deadLetter } },
];

let postgres: TestPostgres;
const databases: MigratedDatabase[] = [];

beforeAll(async () => {
  postgres = await startPostgres();
});

afterAll(async () => {
  await closeAllThenStop(
    databases.map((database) => () => database.handle.close()),
    postgres,
  );
});

async function migrated(): Promise<MigratedDatabase> {
  const database = await createMigratedDatabase(postgres);
  databases.push(database);
  return database;
}

async function until<T>(read: () => Promise<T | undefined>, what: string, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

const anyPayload = z.object({}).passthrough();

describe('queue installation (DATA-2)', () => {
  it('is a separate idempotent step: creates queues once, then only refreshes them', async () => {
    const database = await migrated();
    const first = await installQueues(database.secret, { specs: TEST_QUEUES });
    expect(first.created).toEqual(TEST_QUEUES.map((spec) => spec.name));
    expect(first.updated).toEqual([]);
    const second = await installQueues(database.secret, { specs: TEST_QUEUES });
    expect(second.created).toEqual([]);
    expect(second.updated).toEqual(TEST_QUEUES.map((spec) => spec.name));
  });
});

describe('worker start-up', () => {
  it('refuses to start, with an actionable message, when the queue schema was not installed', async () => {
    const database = await migrated();
    const runtime = new WorkerRuntime({
      logger: createLogger({ level: 'silent', service: 'worker' }),
      db: database.handle,
      now: () => new Date(),
      options: {
        databaseUrl: database.secret,
        heartbeatCron: '* * * * *',
        shutdownTimeoutMs: 5000,
        health: null,
        gatewayMode: 'fake',
      },
    });
    const error = await runtime.start().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WorkerStartError);
    expect((error as Error).message).toMatch(/db:queue:install/);
    // The runtime did not migrate anything on its own.
    const schema = await database.handle.pool.query(`select 1 from information_schema.schemata where schema_name = 'pgboss'`);
    expect(schema.rowCount).toBe(0);
  });
});

describe('worker runtime', () => {
  it('runs the heartbeat, retries only transient failures, dead-letters permanent ones and stops gracefully', async () => {
    const database = await migrated();
    await installQueues(database.secret, { specs: TEST_QUEUES });

    let permanentCalls = 0;
    let transientCalls = 0;
    const permanent: JobHandler<Record<string, unknown>> = {
      queue: PERMANENT_QUEUE,
      payload: anyPayload,
      handle: () => {
        permanentCalls += 1;
        return Promise.reject(new PermanentJobError('cannot ever succeed'));
      },
    };
    const transient: JobHandler<Record<string, unknown>> = {
      queue: TRANSIENT_QUEUE,
      payload: anyPayload,
      handle: () => {
        transientCalls += 1;
        return Promise.reject(new TransientJobError('dependency down'));
      },
    };

    const capture = captureLogs();
    const runtime = new WorkerRuntime({
      logger: createLogger({ level: 'info', service: 'worker', destination: capture.stream }),
      db: database.handle,
      now: () => new Date(),
      queues: TEST_QUEUES,
      extraHandlers: [permanent as JobHandler<unknown>, transient as JobHandler<unknown>],
      options: {
        databaseUrl: database.secret,
        heartbeatCron: '*/5 * * * *',
        shutdownTimeoutMs: 10_000,
        health: { host: '127.0.0.1', port: 0 },
        gatewayMode: 'fake',
        pollingIntervalSeconds: 0.5,
      },
    });
    await runtime.start();
    try {
      // First beat is recorded at start; it carries the gateway mode for the API.
      const started = await readWorkerHeartbeat(database.handle.db);
      expect(started?.cursor).toMatchObject({ gatewayMode: 'fake' });
      const firstBeat = started?.lastBeatAt;
      expect(firstBeat).toBeInstanceOf(Date);

      // Health endpoint for the container HEALTHCHECK.
      const health = await fetch(`http://127.0.0.1:${runtime.healthPort}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: 'ok', state: 'ok' });
      expect((await fetch(`http://127.0.0.1:${runtime.healthPort}/other`)).status).toBe(404);

      // The scheduled job is registered.
      const schedules = await runtime.boss.getSchedules();
      expect(schedules.find((schedule) => schedule.name === QUEUE_NAMES.syncHeartbeat)?.cron).toBe('*/5 * * * *');

      // A heartbeat job goes through the queue and updates the row.
      await runtime.boss.send(QUEUE_NAMES.syncHeartbeat, {});
      await until(async () => {
        const beat = await readWorkerHeartbeat(database.handle.db);
        return beat?.lastBeatAt && firstBeat && beat.lastBeatAt.getTime() > firstBeat.getTime() ? true : undefined;
      }, 'a heartbeat job to run');

      // A permanent failure runs once and lands in the dead-letter queue: no retries.
      await runtime.boss.send(PERMANENT_QUEUE, { marker: 'p' });
      await until(async () => {
        const { rows } = await database.handle.pool.query<{ n: number }>(
          `select count(*)::int as n from pgboss.job where name = $1`,
          [QUEUE_NAMES.deadLetter],
        );
        return (rows[0]?.n ?? 0) >= 1 ? true : undefined;
      }, 'the permanent failure in the dead-letter queue');
      expect(permanentCalls).toBe(1);

      // A transient failure is retried up to the queue's limit, then dead-lettered.
      await runtime.boss.send(TRANSIENT_QUEUE, { marker: 't' });
      await until(async () => (transientCalls >= 2 ? true : undefined), 'the transient retry', 30_000);
      await until(async () => {
        const { rows } = await database.handle.pool.query<{ n: number }>(
          `select count(*)::int as n from pgboss.job where name = $1`,
          [QUEUE_NAMES.deadLetter],
        );
        return (rows[0]?.n ?? 0) >= 2 ? true : undefined;
      }, 'the exhausted transient job in the dead-letter queue', 30_000);
      expect(transientCalls).toBe(2);
      expect(permanentCalls).toBe(1);

      // Every log line of a job run carries its job id and queue.
      const jobLines = capture.lines().filter((line) => line['msg'] === 'job failed permanently; sent to dead-letter queue' && line['queue'] === PERMANENT_QUEUE);
      expect(jobLines.length).toBeGreaterThan(0);
      for (const line of jobLines) expect(line['jobId']).toEqual(expect.any(String));
    } finally {
      await runtime.stop();
    }

    // Graceful stop: the health endpoint is gone and the state is stopping.
    expect(runtime.health.snapshot().state).toBe('stopping');
    await expect(fetch(`http://127.0.0.1:${runtime.healthPort ?? 1}/health`)).rejects.toThrow();
  });
});
