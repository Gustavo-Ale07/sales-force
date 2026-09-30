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
  '0004_sales_order_item_discount_percent',
  '0005_sales_order_erp_binding',
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

  it('upgrades a database at the previous version (expand-only: 0004 only adds a defaulted column and a check)', async () => {
    const url = await pgc.createDatabase();
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sf-migrations-'));
    await cp(defaultMigrationsDir, dir, { recursive: true });
    // Previous release: journal without 0004.
    const journalPath = path.join(dir, 'meta', '_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { entries: { tag: string }[] };
    journal.entries = journal.entries.filter((e) => e.tag !== '0004_sales_order_item_discount_percent' && e.tag !== '0005_sales_order_erp_binding');
    await writeFile(journalPath, JSON.stringify(journal));
    const prev = await runMigrations(url, { ...quiet, migrationsDir: dir });
    expect(prev.applied).toEqual(ALL_MIGRATIONS.slice(0, -2));
    expect(await query(url, `SELECT to_regclass('public.customer_order_template') AS t`)).toEqual([{ t: 'customer_order_template' }]);

    // Existing rows must survive untouched.
    const acc = '018f0000-0000-7000-8000-000000000001';
    const cfg = '018f0000-0000-7000-8000-000000000002';
    const ord = '018f0000-0000-7000-8000-000000000003';
    await query(url, `INSERT INTO account (id, email, display_name, password_hash, role) VALUES ($1, 'u@example.test', 'U', 'x', 'seller')`, [acc]);
    await query(url, `INSERT INTO installation_configuration_version (id, version_label, source_kind, payload, content_hash, synced_at) VALUES ($1, 'v', 'demo', '{}', 'h', now())`, [cfg]);
    await query(url, `INSERT INTO sales_order (id, customer_code, created_by_account_id, client_request_id, config_version_id) VALUES ($1, 1, $2, $3, $4)`, [ord, acc, '018f0000-0000-7000-8000-000000000004', cfg]);
    await query(url, `INSERT INTO sales_order_item (id, order_id, line_no, product_code, product_description, quantity, unit_list_price, price_state, price_table_code, price_version_id, estimated_line_total) VALUES ($1, $2, 1, 10, 'P', 2, 5, 'priced', 1, 1, 10)`, ['018f0000-0000-7000-8000-000000000005', ord]);

    // Deploy the new release: only the new migration runs.
    const next = await runMigrations(url, quiet);
    expect(next.applied).toEqual(['0004_sales_order_item_discount_percent', '0005_sales_order_erp_binding']);
    expect(next.alreadyApplied).toBe(N - 2);
    expect(await query(url, `SELECT id FROM sales_order`)).toEqual([{ id: ord }]);
    // The existing line is kept as it was, with no discount.
    expect(await query(url, `SELECT quantity::text AS q, estimated_line_total::text AS t, discount_percent::text AS d FROM sales_order_item`)).toEqual([{ q: '2.0000', t: '10.00', d: '0.00' }]);
    await expect(query(url, `UPDATE sales_order_item SET discount_percent = 100`)).rejects.toThrow(/sales_order_item_discount_percent_chk/);
    await expect(query(url, `UPDATE sales_order_item SET discount_percent = -1`)).rejects.toThrow(/sales_order_item_discount_percent_chk/);
    await query(url, `UPDATE sales_order_item SET discount_percent = 99.99`);

    // Expand-only guard: the file only adds a defaulted NOT NULL column and a check; it never drops, renames or rewrites.
    const file = await readFile(path.join(defaultMigrationsDir, '0004_sales_order_item_discount_percent.sql'), 'utf8');
    const statements = file.split('--> statement-breakpoint').map((s) => s.trim());
    expect(statements).toHaveLength(2);
    expect(statements[0]).toMatch(/^ALTER TABLE "sales_order_item" ADD COLUMN "discount_percent" numeric\(5, 2\) DEFAULT '0' NOT NULL;$/);
    expect(statements[1]).toMatch(/^ALTER TABLE "sales_order_item" ADD CONSTRAINT "sales_order_item_discount_percent_chk" CHECK /);
    expect(file).not.toMatch(/DROP|RENAME|TYPE|TRUNCATE|DELETE/i);
  });

  it('0005 is additive: existing orders become legacy_dev, the ERP gate holds at the database', async () => {
    const url = await pgc.createDatabase();
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sf-migrations-'));
    await cp(defaultMigrationsDir, dir, { recursive: true });
    const journalPath = path.join(dir, 'meta', '_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { entries: { tag: string }[] };
    journal.entries = journal.entries.filter((e) => e.tag !== '0005_sales_order_erp_binding');
    await writeFile(journalPath, JSON.stringify(journal));
    await runMigrations(url, { ...quiet, migrationsDir: dir });

    const acc = '018f0000-0000-7000-8000-000000000001';
    const cfg = '018f0000-0000-7000-8000-000000000002';
    const ord = '018f0000-0000-7000-8000-000000000003';
    const sankhyaOrd = '018f0000-0000-7000-8000-00000000000b';
    const unboundOrd = '018f0000-0000-7000-8000-00000000000d';
    const outboxId = '018f0000-0000-7000-8000-00000000000f';
    const insertOutbox = (id: string, aggregateId: string) =>
      query(url, `INSERT INTO integration_outbox (id, aggregate_type, aggregate_id, operation, payload) VALUES ($1, 'sales_order', $2, 'submit', '{}')`, [id, aggregateId]);
    await query(url, `INSERT INTO account (id, email, display_name, password_hash, role) VALUES ($1, 'u@example.test', 'U', 'x', 'seller')`, [acc]);
    await query(url, `INSERT INTO installation_configuration_version (id, version_label, source_kind, payload, content_hash, synced_at) VALUES ($1, 'v', 'demo', '{}', 'h', now())`, [cfg]);
    await query(url, `INSERT INTO sales_order (id, customer_code, created_by_account_id, client_request_id, config_version_id) VALUES ($1, 1, $2, $3, $4)`, [ord, acc, '018f0000-0000-7000-8000-000000000004', cfg]);
    await query(url, `INSERT INTO sales_order (id, customer_code, created_by_account_id, client_request_id, config_version_id, status) VALUES ($1, 2, $2, $3, $4, 'cancelled')`, ['018f0000-0000-7000-8000-000000000006', acc, '018f0000-0000-7000-8000-000000000007', cfg]);

    const next = await runMigrations(url, quiet);
    expect(next.applied).toEqual(['0005_sales_order_erp_binding']);
    // Backfill: every pre-existing order is legacy and unbound; nothing else changed.
    expect(await query(url, `SELECT dataset_origin, erp_environment, status FROM sales_order ORDER BY customer_code`)).toEqual([
      { dataset_origin: 'legacy_dev', erp_environment: null, status: 'draft' },
      { dataset_origin: 'legacy_dev', erp_environment: null, status: 'cancelled' },
    ]);

    // A legacy order can never be queued/sent, whatever writes it.
    await expect(query(url, `UPDATE sales_order SET status = 'queued' WHERE id = $1`, [ord])).rejects.toThrow(/sales_order_erp_eligibility_chk/);
    await expect(query(url, `UPDATE sales_order SET status = 'sent' WHERE id = $1`, [ord])).rejects.toThrow(/sales_order_erp_eligibility_chk/);
    // ... cannot be re-labelled as a Sankhya order (immutable binding) ...
    await expect(query(url, `UPDATE sales_order SET dataset_origin = 'sankhya', erp_environment = 'sandbox' WHERE id = $1`, [ord])).rejects.toThrow(/immutable/);
    // ... and cannot enter the outbox; neither can an order that does not exist.
    await expect(insertOutbox('018f0000-0000-7000-8000-000000000008', ord)).rejects.toThrow(/not eligible for ERP submission/);
    await expect(insertOutbox('018f0000-0000-7000-8000-000000000009', '018f0000-0000-7000-8000-00000000000a')).rejects.toThrow(/not eligible for ERP submission/);

    // A bound Sankhya order is accepted; a Sankhya order with no environment is not.
    await query(url, `INSERT INTO sales_order (id, customer_code, created_by_account_id, client_request_id, config_version_id, dataset_origin, erp_environment) VALUES ($1, 3, $2, $3, $4, 'sankhya', 'sandbox')`, [sankhyaOrd, acc, '018f0000-0000-7000-8000-00000000000c', cfg]);
    await query(url, `INSERT INTO sales_order (id, customer_code, created_by_account_id, client_request_id, config_version_id, dataset_origin) VALUES ($1, 4, $2, $3, $4, 'sankhya')`, [unboundOrd, acc, '018f0000-0000-7000-8000-00000000000e', cfg]);
    await insertOutbox(outboxId, sankhyaOrd);
    await expect(insertOutbox('018f0000-0000-7000-8000-000000000010', unboundOrd)).rejects.toThrow(/not eligible for ERP submission/);
    await expect(query(url, `UPDATE sales_order SET status = 'queued' WHERE id = $1`, [unboundOrd])).rejects.toThrow(/sales_order_erp_eligibility_chk/);
    await query(url, `UPDATE sales_order SET status = 'queued' WHERE id = $1`, [sankhyaOrd]);
    // Defensive re-check at claim time: an outbox row re-pointed to a legacy order cannot be claimed.
    await expect(query(url, `UPDATE integration_outbox SET aggregate_id = $1, status = 'processing' WHERE id = $2`, [ord, outboxId])).rejects.toThrow(/not eligible for ERP submission/);

    // Additive guard: no table/column drop, no data removal, no rewrite of existing constraints.
    const file = await readFile(path.join(defaultMigrationsDir, '0005_sales_order_erp_binding.sql'), 'utf8');
    expect(file).not.toMatch(/DROP\s+(TABLE|COLUMN|CONSTRAINT)|TRUNCATE|DELETE\s+FROM|RENAME|ALTER\s+COLUMN/i);
    expect(file).not.toMatch(/UPDATE\s+"?sales_order"?\s+SET/i);
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
      path.join(dir, '0006_broken.sql'),
      'CREATE TABLE ok_table (id int);\n--> statement-breakpoint\nCREATE TABLE ok_table (id int);\n',
    );
    const journalPath = path.join(dir, 'meta', '_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
      entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
    };
    journal.entries.push({ idx: N, version: '7', when: Date.now(), tag: '0006_broken', breakpoints: true });
    await writeFile(journalPath, JSON.stringify(journal));

    const err = await runMigrations(url, { ...quiet, migrationsDir: dir }).catch((e) => e);
    expect(err).toBeInstanceOf(MigrationError);
    expect((err as Error).message).toMatch(/0006_broken failed and was rolled back/);
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
        lastId: '0005_sales_order_erp_binding',
        expectedCount: N,
        upToDate: true,
      });
    } finally {
      await handle.close();
    }
  });
});
