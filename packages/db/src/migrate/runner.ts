import pg from 'pg';
import { loadMigrations, defaultMigrationsDir } from './files.js';

/** Fixed advisory-lock key: serializes migration runs of one database (DATA-2 item 7). */
export const MIGRATION_LOCK_KEY = 7_283_411_001;
export const MIGRATION_TABLE = 'schema_migration';

export class MigrationError extends Error {
  override name = 'MigrationError';
}

export interface RunMigrationsOptions {
  migrationsDir?: string;
  /** Max time to wait for the advisory lock held by another runner (default 300000 ms). */
  lockTimeoutMs?: number;
  /** Log sink; never receives the connection string (default: console.log). */
  log?: (message: string) => void;
}

export interface RunMigrationsResult {
  /** Tags applied by this run, in order. */
  applied: string[];
  /** Number of migrations already applied before this run. */
  alreadyApplied: number;
  /** Tags applied in the database but unknown to this build (database ahead of the code). */
  unknown: string[];
}

/** Host/port/database of a connection string, without credentials, for messages. */
export function describeTarget(databaseUrl: string): string {
  try {
    const u = new URL(databaseUrl);
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return '<invalid DATABASE_URL>';
  }
}

/**
 * One-shot, concurrency-protected migration run.
 * - Takes a session-level pg_advisory_lock (waits, with timeout) so only one runner executes.
 * - Applies each pending migration in its own transaction and records it in `schema_migration`.
 * - Refuses to continue if an already-applied migration file was edited (hash mismatch).
 * - Re-running with nothing pending is a no-op.
 */
export async function runMigrations(
  databaseUrl: string,
  options: RunMigrationsOptions = {},
): Promise<RunMigrationsResult> {
  const log = options.log ?? ((m: string) => console.log(m));
  const lockTimeoutMs = Math.trunc(options.lockTimeoutMs ?? 300_000);
  const target = describeTarget(databaseUrl);

  const migrations = await loadMigrations(options.migrationsDir ?? defaultMigrationsDir);

  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 15_000 });
  try {
    await client.connect();
  } catch (cause) {
    throw new MigrationError(`Cannot connect to the database at ${target}: ${errorMessage(cause)}`, {
      cause: sanitizeCause(cause),
    });
  }

  let locked = false;
  try {
    log(`[migrate] target ${target}; waiting for migration lock`);
    await client.query(`SET lock_timeout = ${lockTimeoutMs}`);
    try {
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
      locked = true;
    } catch (cause) {
      throw new MigrationError(
        `Could not obtain the migration lock within ${lockTimeoutMs} ms; another migration run may be in progress: ${errorMessage(cause)}`,
        { cause: sanitizeCause(cause) },
      );
    }
    await client.query('SET lock_timeout = 0');

    await client.query(
      `CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
         idx integer PRIMARY KEY,
         tag text NOT NULL UNIQUE,
         hash text NOT NULL,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );

    const { rows } = await client.query<{ idx: number; tag: string; hash: string }>(
      `SELECT idx, tag, hash FROM ${MIGRATION_TABLE} ORDER BY idx`,
    );
    const appliedByTag = new Map(rows.map((r) => [r.tag, r]));
    const knownTags = new Set(migrations.map((m) => m.tag));
    const unknown = rows.filter((r) => !knownTags.has(r.tag)).map((r) => r.tag);
    if (unknown.length > 0) {
      log(
        `[migrate] warning: database has migrations unknown to this version (${unknown.join(', ')}); continuing (database is ahead of the code)`,
      );
    }

    const applied: string[] = [];
    for (const m of migrations) {
      const existing = appliedByTag.get(m.tag);
      if (existing) {
        if (existing.hash !== m.hash) {
          throw new MigrationError(
            `Migration ${m.tag} was already applied but its file content changed (recorded hash ${existing.hash.slice(0, 12)}, current ${m.hash.slice(0, 12)}). Applied migrations are immutable: add a new migration instead.`,
          );
        }
        continue;
      }
      log(`[migrate] applying ${m.tag} (${m.statements.length} statements)`);
      try {
        await client.query('BEGIN');
        for (const statement of m.statements) {
          await client.query(statement);
        }
        await client.query(`INSERT INTO ${MIGRATION_TABLE} (idx, tag, hash) VALUES ($1, $2, $3)`, [
          m.idx,
          m.tag,
          m.hash,
        ]);
        await client.query('COMMIT');
      } catch (cause) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new MigrationError(
          `Migration ${m.tag} failed and was rolled back: ${errorMessage(cause)}`,
          { cause: sanitizeCause(cause) },
        );
      }
      applied.push(m.tag);
    }

    log(
      applied.length === 0
        ? `[migrate] up to date (${rows.length} migrations applied)`
        : `[migrate] done: applied ${applied.length} migration(s): ${applied.join(', ')}`,
    );
    return { applied, alreadyApplied: rows.length, unknown };
  } finally {
    if (locked) {
      await client
        .query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
        .catch(() => undefined);
    }
    await client.end().catch(() => undefined);
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Drops anything from the cause that could carry the connection string. */
function sanitizeCause(e: unknown): unknown {
  return e instanceof Error ? new Error(e.message) : e;
}
