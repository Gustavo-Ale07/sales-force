import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MIGRATION_LOCK_KEY,
  MigrationError,
  createDb,
  readiness,
  runMigrations,
} from '../src/index.js';
import { defaultMigrationsDir } from '../src/migrate/files.js';
import { startPostgres, type TestPostgres } from './helpers.js';

const ALL_MIGRATIONS = [
  '0000_initial_schema',
  '0001_auth_throttle',
  '0002_sales_order_client_request_hash',
  '0003_customer_order_template',
];
const N = ALL_MIGRATIONS.length;

let pgc: TestPostgres;
const quiet = { log: () => undefined };

beforeAll(async () => {
  pgc = await startPostgres();
});
afterAll(async () => {
  await pgc?.stop();
});

async function query<T extends pg.QueryResultRow>(url: string, sql: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query<T>(sql, params)).rows;
  } finally {
    await c.end();
  }
}

describe('migrations', () => {
  it('applies from an empty database and creates the expected tables', async () => {
    const url = await pgc.createDatabase();
    const result = await runMigrations(url, quiet);
    expect(result.applied).toEqual(ALL_MIGRATIONS);
    expect(result.alreadyApplied).toBe(0);

    const tables = await query<{ table_name: string }>(
      url,
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
    );
    expect(tables.map((t) => t.table_name)).toEqual(
      [
        'account',
        'account_seller_link',
        'audit_log',
        'auth_throttle',
        'customer_order_template',
        'customer_order_template_item',
        'erp_customer',
        'erp_list_price',
        'erp_price_table',
        'erp_price_table_version',
        'erp_product',
        'erp_seller',
        'installation_configuration_version',
        'integration_outbox',
        'sales_order',
        'sales_order_item',
        'schema_migration',
        'session',
        'sync_state',
      ].sort(),
    );

    const ext = await query(url, `SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`);
    expect(ext).toHaveLength(1);
  });

  it('re-running is a no-op', async () => {
    const url = await pgc.createDatabase();
    await runMigrations(url, quiet);
    const second = await runMigrations(url, quiet);
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toBe(N);
    const rows = await query(url, `SELECT * FROM schema_migration`);
    expect(rows).toHaveLength(N);
  });

  it('upgrades a database at the previous version (expand-only: 0003 only adds objects)', async () => {
    const url = await pgc.createDatabase();
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sf-migrations-'));
    await cp(defaultMigrationsDir, dir, { recursive: true });
    // Previous release: journal without 0003.
    const journalPath = path.join(dir, 'meta', '_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { entries: { tag: string }[] };
    journal.entries = journal.entries.filter((e) => e.tag !== '0003_customer_order_template');
    await writeFile(journalPath, JSON.stringify(journal));
    const prev = await runMigrations(url, { ...quiet, migrationsDir: dir });
    expect(prev.applied).toEqual(ALL_MIGRATIONS.slice(0, -1));
    expect(await query(url, `SELECT to_regclass('public.customer_order_template') AS t`)).toEqual([{ t: null }]);

    // Existing rows must survive untouched.
    const acc = '018f0000-0000-7000-8000-000000000001';
    const cfg = '018f0000-0000-7000-8000-000000000002';
    const ord = '018f0000-0000-7000-8000-000000000003';
    await query(url, `INSERT INTO account (id, email, display_name, password_hash, role) VALUES ($1, 'u@example.test', 'U', 'x', 'seller')`, [acc]);
    await query(url, `INSERT INTO installation_configuration_version (id, version_label, source_kind, payload, content_hash, synced_at) VALUES ($1, 'v', 'demo', '{}', 'h', now())`, [cfg]);
    await query(url, `INSERT INTO sales_order (id, customer_code, created_by_account_id, client_request_id, config_version_id) VALUES ($1, 1, $2, $3, $4)`, [ord, acc, '018f0000-0000-7000-8000-000000000004', cfg]);

    // Deploy the new release: only the new migration runs.
    const next = await runMigrations(url, quiet);
    expect(next.applied).toEqual(['0003_customer_order_template']);
    expect(next.alreadyApplied).toBe(N - 1);
    expect(await query(url, `SELECT id FROM sales_order`)).toEqual([{ id: ord }]);
    expect(await query(url, `SELECT count(*)::int AS n FROM customer_order_template`)).toEqual([{ n: 0 }]);

    // Expand-only guard: the file creates objects and never alters/drops/rewrites existing ones.
    const file = await readFile(path.join(defaultMigrationsDir, '0003_customer_order_template.sql'), 'utf8');
    const statements = file.split('--> statement-breakpoint').map((s) => s.trim());
    expect(statements.length).toBeGreaterThan(0);
    for (const stmt of statements) {
      expect(stmt).toMatch(
        /^(CREATE TABLE "customer_order_template[a-z_]*"|CREATE UNIQUE INDEX "[a-z_]+" ON "customer_order_template[a-z_]*"|ALTER TABLE "customer_order_template[a-z_]*" ADD CONSTRAINT )/,
      );
    }
  });

  it('two concurrent runners do not corrupt the database (advisory lock)', async () => {
    const url = await pgc.createDatabase();
    const results = await Promise.all([
      runMigrations(url, quiet),
      runMigrations(url, quiet),
      runMigrations(url, quiet),
    ]);
    // Exactly one runner applied the migrations; the others found them applied.
    expect(results.filter((r) => r.applied.length === N)).toHaveLength(1);
    expect(results.filter((r) => r.applied.length === 0)).toHaveLength(2);
    const rows = await query(url, `SELECT * FROM schema_migration`);
    expect(rows).toHaveLength(N);
  });

  it('waits for, and fails clearly on, a held migration lock', async () => {
    const url = await pgc.createDatabase();
    const holder = new pg.Client({ connectionString: url });
    await holder.connect();
    try {
      await holder.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
      const err = await runMigrations(url, { ...quiet, lockTimeoutMs: 500 }).catch((e) => e);
      expect(err).toBeInstanceOf(MigrationError);
      expect((err as Error).message).toMatch(/migration lock/);
      // Nothing was applied while the lock was held.
      expect(await query(url, `SELECT to_regclass('public.account') AS t`)).toEqual([{ t: null }]);
    } finally {
      await holder.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
      await holder.end();
    }
    // Once released, the run succeeds.
    const ok = await runMigrations(url, quiet);
    expect(ok.applied).toEqual(ALL_MIGRATIONS);
  });

  it('refuses when an applied migration file was edited', async () => {
    const url = await pgc.createDatabase();
    await runMigrations(url, quiet);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sf-migrations-'));
    await cp(defaultMigrationsDir, dir, { recursive: true });
    const file = path.join(dir, '0000_initial_schema.sql');
    await writeFile(file, (await readFile(file, 'utf8')) + '\n-- tampered\n');
    const err = await runMigrations(url, { ...quiet, migrationsDir: dir }).catch((e) => e);
    expect(err).toBeInstanceOf(MigrationError);
    expect((err as Error).message).toMatch(/already applied but its file content changed/);
  });

  it('rolls a failing migration back atomically and does not record it', async () => {
    const url = await pgc.createDatabase();
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sf-migrations-'));
    await cp(defaultMigrationsDir, dir, { recursive: true });
    await writeFile(
      path.join(dir, '0004_broken.sql'),
      'CREATE TABLE ok_table (id int);\n--> statement-breakpoint\nCREATE TABLE ok_table (id int);\n',
    );
    const journalPath = path.join(dir, 'meta', '_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
      entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
    };
    journal.entries.push({ idx: N, version: '7', when: Date.now(), tag: '0004_broken', breakpoints: true });
    await writeFile(journalPath, JSON.stringify(journal));

    const err = await runMigrations(url, { ...quiet, migrationsDir: dir }).catch((e) => e);
    expect(err).toBeInstanceOf(MigrationError);
    expect((err as Error).message).toMatch(/0004_broken failed and was rolled back/);
    expect(await query(url, `SELECT to_regclass('public.ok_table') AS t`)).toEqual([{ t: null }]);
    const recorded = await query<{ tag: string }>(url, `SELECT tag FROM schema_migration ORDER BY idx`);
    expect(recorded.map((r) => r.tag)).toEqual(ALL_MIGRATIONS);
  });

  it('error messages never contain the password', async () => {
    const url = new URL(await pgc.createDatabase());
    url.password = 'super-secret-pw';
    const err = await runMigrations(url.toString(), quiet).catch((e) => e);
    expect(err).toBeInstanceOf(MigrationError);
    expect(String((err as Error).message)).not.toContain('super-secret-pw');
  });

  it('readiness reports migration level before and after', async () => {
    const url = await pgc.createDatabase();
    const handle = createDb(url);
    try {
      expect(await readiness(handle.pool)).toMatchObject({
        appliedCount: 0,
        lastId: null,
        expectedCount: N,
        upToDate: false,
      });
      await runMigrations(url, quiet);
      expect(await readiness(handle.pool)).toEqual({
        appliedCount: N,
        lastId: '0003_customer_order_template',
        expectedCount: N,
        upToDate: true,
      });
    } finally {
      await handle.close();
    }
  });
});
