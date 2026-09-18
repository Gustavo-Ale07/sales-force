import type pg from 'pg';
import { loadMigrations, defaultMigrationsDir } from './migrate/files.js';
import { MIGRATION_TABLE } from './migrate/runner.js';

export interface MigrationLevel {
  /** Number of migrations recorded as applied. */
  appliedCount: number;
  /** Tag of the last applied migration, or null when none. */
  lastId: string | null;
  /** Number of migrations this build expects (from the journal), or null if it cannot be read. */
  expectedCount: number | null;
  /** True when the database has every migration this build expects. */
  upToDate: boolean;
}

/** Read-only migration level for `/ready`. Throws if the database is unreachable. */
export async function readiness(
  pool: pg.Pool | pg.Client,
  migrationsDir: string = defaultMigrationsDir,
): Promise<MigrationLevel> {
  const exists = await pool.query<{ t: string | null }>(`SELECT to_regclass($1) AS t`, [
    `public.${MIGRATION_TABLE}`,
  ]);
  let appliedCount = 0;
  let lastId: string | null = null;
  const appliedTags = new Set<string>();
  if (exists.rows[0]?.t) {
    const { rows } = await pool.query<{ idx: number; tag: string }>(
      `SELECT idx, tag FROM ${MIGRATION_TABLE} ORDER BY idx`,
    );
    appliedCount = rows.length;
    lastId = rows.at(-1)?.tag ?? null;
    for (const r of rows) appliedTags.add(r.tag);
  }
  try {
    const expected = await loadMigrations(migrationsDir);
    return {
      appliedCount,
      lastId,
      expectedCount: expected.length,
      upToDate: expected.every((m) => appliedTags.has(m.tag)),
    };
  } catch {
    // Journal not readable from this build: report the database side only.
    return { appliedCount, lastId, expectedCount: null, upToDate: false };
  }
}
