import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
  /** Ends the pool. Call on graceful shutdown. */
  close: () => Promise<void>;
}

export interface CreateDbOptions {
  /** Max pooled connections (default 10). */
  max?: number;
  /** Optional application_name shown in pg_stat_activity (e.g. "salesforce-api"). */
  applicationName?: string;
}

/** Creates a typed Drizzle handle over a pg pool. Does not run migrations (never at app start). */
export function createDb(databaseUrl: string, options: CreateDbOptions = {}): DbHandle {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: options.max ?? 10,
    application_name: options.applicationName,
  });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
