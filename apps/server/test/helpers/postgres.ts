import { randomBytes } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb, runMigrations, type CreateDbOptions, type DbHandle } from '@salesforce/db';
import { Secret } from '@salesforce/sankhya';
import pg from 'pg';

/** Same major as the dev database and the intended production line (DATA-1). */
export const POSTGRES_IMAGE = 'postgres:17';

export interface TestPostgres {
  readonly container: StartedPostgreSqlContainer;
  /** Creates an empty, uniquely named database and returns its connection URL. */
  createDatabase(): Promise<string>;
  stop(): Promise<void>;
}

/** Disposable PostgreSQL (Testcontainers). Tests never touch a shared, staging or production database. */
export async function startPostgres(options: { closeDeadlineMs?: number } = {}): Promise<TestPostgres> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const adminUrl = container.getConnectionUri();
  return {
    container,
    createDatabase: async () => {
      const name = `t_${randomBytes(6).toString('hex')}`;
      const admin = new pg.Client({ connectionString: adminUrl });
      await admin.connect();
      try {
        await admin.query(`CREATE DATABASE ${name}`);
      } finally {
        await admin.end();
      }
      const url = new URL(adminUrl);
      url.pathname = `/${name}`;
      return url.toString();
    },
    stop: async () => {
      try {
        // Never stop PostgreSQL while a client backend is still attached: a fast shutdown would send 57P01 to it.
        await waitForNoClientBackends(adminUrl, options.closeDeadlineMs ?? CLOSE_DEADLINE_MS);
        // A pool that reported an error and was never closed (or closed after the fact) must still fail the file.
        const unreported = [...unreportedPoolErrors];
        if (unreported.length > 0) throw new AggregateError(unreported, `${unreported.length} pool error(s) were never reported by close()`);
      } finally {
        await container.stop();
      }
    },
  };
}

/** How long a pool/server may take to finish closing connections that were already ended; a leak fails instead of hanging. */
const CLOSE_DEADLINE_MS = 15_000;

/** Pool errors not yet handed to a `close()`; `stop()` fails the file while any remain. */
const unreportedPoolErrors = new Set<Error>();

/**
 * pg-pool's `end()` resolves as soon as it has dropped its clients from its own list, BEFORE their sockets are closed
 * (`_remove` calls `client.end(cb)` and forgets it). The server may therefore still hold the backends when the test
 * file stops the container (the admin role is a superuser, so pg_stat_activity shows the sessions of every role); the fast shutdown then answers them with 57P01 and an idle client with no error listener
 * turns that into an unhandled error. This asks the server, over its own connection, until no client backend is left.
 */
async function waitForNoClientBackends(adminUrl: string, deadlineMs: number): Promise<void> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const deadline = Date.now() + deadlineMs;
    for (;;) {
      const { rows } = await admin.query<{ datname: string | null; application_name: string; n: number }>(
        `select datname, application_name, count(*)::int as n from pg_stat_activity
          where backend_type = 'client backend' and pid <> pg_backend_pid() group by 1, 2`,
      );
      if (rows.length === 0) return;
      if (Date.now() > deadline) {
        const left = rows.map((r) => `${r.n} x application_name='${r.application_name}' (db ${r.datname ?? '-'})`).join('; ');
        throw new Error(`PostgreSQL still has client connections after ${deadlineMs} ms: ${left}. A test did not close its pool/client before stopping the container.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } finally {
    await admin.end();
  }
}

/**
 * A pool handle whose `close()` returns only when every client socket is really closed (pool 'remove' events), and which
 * fails the file when the pool reported an error meanwhile instead of letting it surface as an unhandled one.
 */
export function createTestDb(url: string, options: CreateDbOptions = {}): DbHandle {
  const handle = createDb(url, options);
  const live = new Set<pg.PoolClient>();
  const poolErrors: Error[] = [];
  handle.pool.on('connect', (client) => live.add(client));
  handle.pool.on('remove', (client) => live.delete(client));
  handle.pool.on('error', (error) => {
    poolErrors.push(error);
    unreportedPoolErrors.add(error);
  });
  return {
    ...handle,
    close: async () => {
      await handle.pool.end();
      if (live.size > 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`${live.size} pool client(s) still open ${CLOSE_DEADLINE_MS} ms after pool.end()`)),
            CLOSE_DEADLINE_MS,
          );
          const onRemove = () => {
            if (live.size > 0) return;
            clearTimeout(timer);
            handle.pool.off('remove', onRemove);
            resolve();
          };
          handle.pool.on('remove', onRemove);
        });
      }
      for (const error of poolErrors) unreportedPoolErrors.delete(error);
      if (poolErrors.length > 0) {
        throw new AggregateError(poolErrors, `the pool reported ${poolErrors.length} error(s) while the test ran`);
      }
    },
  };
}

/**
 * The shared `afterAll` of every integration file: closes every handle (last opened first), then stops PostgreSQL, whatever
 * fails on the way. Failures are collected and rethrown together, never swallowed, so one bad closer cannot leave the others
 * open or skip `stop()`.
 */
export async function closeAllThenStop(closers: readonly (() => Promise<unknown>)[], postgres: TestPostgres | undefined): Promise<void> {
  const failures: unknown[] = [];
  for (const close of [...closers].reverse()) {
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    await postgres?.stop();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) throw new AggregateError(failures, `test teardown failed (${failures.length})`);
}

export interface MigratedDatabase {
  readonly url: string;
  readonly secret: Secret;
  readonly handle: DbHandle;
}

/** A fresh database with every migration applied. */
export async function createMigratedDatabase(postgres: TestPostgres): Promise<MigratedDatabase> {
  const url = await postgres.createDatabase();
  await runMigrations(url, { log: () => undefined });
  return { url, secret: new Secret(url), handle: createTestDb(url, { max: 4, applicationName: 'salesforce-test' }) };
}

/** Captures pino output as parsed JSON lines. */
export function captureLogs(): { stream: { write(chunk: string): void }; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  return {
    stream: { write: (chunk: string) => void chunks.push(chunk) },
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
