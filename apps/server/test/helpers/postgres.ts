import { randomBytes } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb, runMigrations, type DbHandle } from '@salesforce/db';
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
export async function startPostgres(): Promise<TestPostgres> {
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
      await container.stop();
    },
  };
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
  return { url, secret: new Secret(url), handle: createDb(url, { max: 4, applicationName: 'salesforce-test' }) };
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
