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
      await container.stop();
    },
  };
}

/** Deterministic-enough unique ids for tests (real code uses UUIDv7 from the app). */
export const uuid = (): string => randomUUID();
