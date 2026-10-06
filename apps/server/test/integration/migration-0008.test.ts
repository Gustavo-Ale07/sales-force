import { cp, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runMigrations } from '@salesforce/db';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeAllThenStop, startPostgres, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;
beforeAll(async () => {
  postgres = await startPostgres();
});
afterAll(async () => {
  await closeAllThenStop([], postgres);
});

const MIGRATIONS = path.resolve(import.meta.dirname, '..', '..', '..', '..', 'packages', 'db', 'migrations');
const ADMIN_ID = '0199a000-0000-7000-8000-000000000001';
const SELLER_ACCOUNT_ID = '0199a000-0000-7000-8000-000000000002';

/** A copy of the migrations folder whose journal stops before 0008 (the production schema at commit 62f50b1). */
async function preMigrationsDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'sf-mig-'));
  await cp(MIGRATIONS, dir, { recursive: true });
  const journalFile = path.join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(journalFile, 'utf8')) as { entries: { idx: number; tag: string }[] };
  journal.entries = journal.entries.filter((e) => !e.tag.startsWith('0008_'));
  await writeFile(journalFile, JSON.stringify(journal));
  return dir;
}

describe('migration 0008 (account.external_user_id)', () => {
  it('upgrades a pre-0008 database in place: keeps admin, sellers and sessions, external_user_id NULL', async () => {
    const url = await postgres.createDatabase();
    const dir = await preMigrationsDir();
    try {
      const before = await runMigrations(url, { migrationsDir: dir, log: () => undefined });
      expect(before.applied.some((t) => t.startsWith('0008_'))).toBe(false);

      const client = new pg.Client({ connectionString: url });
      await client.connect();
      try {
        await client.query(
          `INSERT INTO account (id, email, display_name, password_hash, role) VALUES
             ($1, 'admin', 'Admin', '$argon2id$synthetic', 'admin'),
             ($2, 'vend@example.test', 'Vendedor', '$argon2id$synthetic', 'seller')`,
          [ADMIN_ID, SELLER_ACCOUNT_ID],
        );
        await client.query(
          `INSERT INTO erp_seller (code, name, active, content_hash, synced_at) VALUES (103, 'Vendedor Sintetico', true, 'h', now())`,
        );
        await client.query(
          `INSERT INTO session (id, account_id, token_hash, expires_at) VALUES ('0199a000-0000-7000-8000-0000000000aa', $1, 'hash', now() + interval '1 day')`,
          [ADMIN_ID],
        );
        const col = await client.query(
          `SELECT 1 FROM information_schema.columns WHERE table_name = 'account' AND column_name = 'external_user_id'`,
        );
        expect(col.rowCount).toBe(0);

        const after = await runMigrations(url, { log: () => undefined });
        expect(after.applied).toEqual(['0008_account_external_user_id']);

        const accounts = await client.query(`SELECT id, role, email, external_user_id FROM account ORDER BY email`);
        expect(accounts.rows).toHaveLength(2);
        expect(accounts.rows.every((r: { external_user_id: unknown }) => r.external_user_id === null)).toBe(true);
        expect(accounts.rows.map((r: { role: string }) => r.role).sort()).toEqual(['admin', 'seller']);
        expect((await client.query(`SELECT count(*)::int AS n FROM erp_seller`)).rows[0]?.n).toBe(1);
        expect((await client.query(`SELECT count(*)::int AS n FROM session`)).rows[0]?.n).toBe(1);

        // Partial unique index: many NULLs allowed, a repeated non-null id refused.
        await client.query(`UPDATE account SET external_user_id = '4501' WHERE id = $1`, [SELLER_ACCOUNT_ID]);
        await expect(client.query(`UPDATE account SET external_user_id = '4501' WHERE id = $1`, [ADMIN_ID])).rejects.toMatchObject({
          code: '23505',
        });
      } finally {
        await client.end();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('applies every migration on an empty database and is a no-op the second time', async () => {
    const url = await postgres.createDatabase();
    const first = await runMigrations(url, { log: () => undefined });
    expect(first.applied).toContain('0008_account_external_user_id');
    expect(first.applied.at(-1)).toBe('0008_account_external_user_id');
    const second = await runMigrations(url, { log: () => undefined });
    expect(second.applied).toEqual([]);
  });
});
