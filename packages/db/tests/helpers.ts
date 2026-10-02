import { randomBytes, randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

/** Same major as the dev database and the intended production line (DATA-1). */
export const POSTGRES_IMAGE = 'postgres:17';

export interface TestPostgres {
  container: StartedPostgreSqlContainer;
  adminUrl: string;
  /** Creates an empty, uniquely named database and returns its connection URL. */
  createDatabase: () => Promise<string>;
  stop: () => Promise<void>;
}

export async function startPostgres(): Promise<TestPostgres> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const adminUrl = container.getConnectionUri();
  return {
    container,
    adminUrl,
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
        await waitForNoClientBackends(adminUrl);
      } finally {
        await container.stop();
      }
    },
  };
}

const CLOSE_DEADLINE_MS = 15_000;

/**
 * pg-pool's `end()` resolves before the client sockets are closed (it drops its clients from its own list and calls
 * `client.end(cb)` without waiting), so the server may still hold backends when a file stops the container. This asks the
 * server, over its own superuser connection, until none is left; a real leak fails with its application_name.
 */
async function waitForNoClientBackends(adminUrl: string): Promise<void> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const deadline = Date.now() + CLOSE_DEADLINE_MS;
    for (;;) {
      const { rows } = await admin.query<{ datname: string | null; application_name: string; n: number }>(
        `select datname, application_name, count(*)::int as n from pg_stat_activity
          where backend_type = 'client backend' and pid <> pg_backend_pid() group by 1, 2`,
      );
      if (rows.length === 0) return;
      if (Date.now() > deadline) {
        const left = rows.map((r) => `${r.n} x application_name='${r.application_name}' (db ${r.datname ?? '-'})`).join('; ');
        throw new Error(`PostgreSQL still has client connections after ${CLOSE_DEADLINE_MS} ms: ${left}. A test did not close its pool/client before stopping the container.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } finally {
    await admin.end();
  }
}

/** Deterministic-enough unique ids for tests (real code uses UUIDv7 from the app). */
export const uuid = (): string => randomUUID();
