import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/index.js';
import { startPostgres, type TestPostgres } from './helpers.js';

/**
 * deploy/staging/db-roles.sql against a real PostgreSQL: applied between the migrations (as the
 * migrator role) and the runtime, it must leave exactly the documented privilege matrix.
 */
const ROLES_SQL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../deploy/staging/db-roles.sql');
const PASSWORDS = {
  force_migrator: `m-${randomBytes(6).toString('hex')}`,
  force_api: `a-${randomBytes(6).toString('hex')}`,
  force_worker: `w-${randomBytes(6).toString('hex')}`,
  force_backup: `b-${randomBytes(6).toString('hex')}`,
};
type Role = keyof typeof PASSWORDS;
type Priv = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'TRUNCATE' | 'REFERENCES' | 'TRIGGER';
const ALL_PRIVS: Priv[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

const S: Priv[] = ['SELECT'];
const SIU: Priv[] = ['SELECT', 'INSERT', 'UPDATE'];
const SIUD: Priv[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
const MIRROR = ['erp_seller', 'erp_directory_user', 'erp_customer', 'erp_product', 'erp_price_table', 'erp_price_table_version', 'erp_list_price'];

/** The matrix documented in db-roles.sql. A table absent here must have no api/worker privilege at all. */
const EXPECTED: Record<string, { api: Priv[]; worker: Priv[] }> = {
  account: { api: SIU, worker: [] },
  session: { api: SIUD, worker: [] },
  account_seller_link: { api: SIUD, worker: [] },
  auth_throttle: { api: SIUD, worker: [] },
  audit_log: { api: ['INSERT'], worker: [] },
  installation_configuration_version: { api: S, worker: S },
  sync_state: { api: S, worker: SIU },
  sales_order: { api: SIU, worker: [] },
  sales_order_item: { api: SIUD, worker: [] },
  customer_order_template: { api: SIU, worker: [] },
  customer_order_template_item: { api: SIUD, worker: [] },
  integration_outbox: { api: [], worker: [] },
  product_media: { api: S, worker: SIUD },
  schema_migration: { api: S, worker: [] },
  ...Object.fromEntries(MIRROR.map((t) => [t, { api: S, worker: SIU }])),
};

let pgc: TestPostgres;
let dbName: string;
let adminDbUrl: string;

beforeAll(async () => {
  pgc = await startPostgres();
  adminDbUrl = await pgc.createDatabase();
  dbName = new URL(adminDbUrl).pathname.slice(1);
  const first = await applyRolesSql(dbName);
  expect(first.exitCode, first.output).toBe(0);
  const result = await runMigrations(roleUrl('force_migrator'), { log: () => undefined });
  expect(result.applied.length).toBeGreaterThan(0);
  // Second pass, as the deploy order allows: grants on the tables that now exist.
  await applyRolesSql(dbName);
});
afterAll(async () => {
  await pgc?.stop();
});

function roleUrl(role: Role, database = dbName): string {
  const u = new URL(pgc.adminUrl);
  u.username = role;
  u.password = PASSWORDS[role];
  u.pathname = `/${database}`;
  return u.toString();
}

async function applyRolesSql(database: string, extra: string[] = [], omit: string[] = []) {
  const target = '/tmp/db-roles.sql';
  await pgc.container.copyContentToContainer([{ content: await readFile(ROLES_SQL, 'utf8'), target }]);
  const vars = Object.entries({
    migrator_password: PASSWORDS.force_migrator,
    api_password: PASSWORDS.force_api,
    worker_password: PASSWORDS.force_worker,
    backup_password: PASSWORDS.force_backup,
  }).filter(([k]) => !omit.includes(k));
  return pgc.container.exec([
    'psql', '-U', pgc.container.getUsername(), '-d', database, '-v', 'ON_ERROR_STOP=1',
    ...vars.flatMap(([k, v]) => ['-v', `${k}=${v}`]),
    ...extra, '-f', target,
  ]);
}

async function as<T extends pg.QueryResultRow = pg.QueryResultRow>(url: string, sql: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query<T>(sql, params)).rows;
  } finally {
    await c.end();
  }
}

/** Runs a statement as a role and returns the SQLSTATE of the failure (undefined = it succeeded). */
async function sqlState(role: Role, sql: string): Promise<string | undefined> {
  try {
    await as(roleUrl(role), sql);
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code ?? 'unknown';
  }
}
const DENIED = '42501';

describe('db-roles.sql', () => {
  it('creates three plain login roles, not superusers, with no memberships', async () => {
    const rows = await as<{ rolname: string; rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolreplication: boolean; rolbypassrls: boolean; rolcanlogin: boolean; rolinherit: boolean }>(
      adminDbUrl,
      `SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolcanlogin, rolinherit FROM pg_roles WHERE rolname LIKE 'force\\_%' ORDER BY rolname`,
    );
    expect(rows.map((r) => r.rolname)).toEqual(['force_api', 'force_backup', 'force_migrator', 'force_worker']);
    for (const r of rows) {
      // force_backup needs INHERIT for its pg_read_all_data membership to apply; the others are NOINHERIT.
      expect(r).toMatchObject({ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false, rolcanlogin: true, rolinherit: r.rolname === 'force_backup' });
    }
    // The only membership of any force_* role is force_backup -> pg_read_all_data.
    expect(await as(adminDbUrl, `SELECT m.rolname AS member, g.rolname AS grp FROM pg_auth_members am JOIN pg_roles m ON m.oid = am.member JOIN pg_roles g ON g.oid = am.roleid WHERE m.rolname LIKE 'force\\_%'`)).toEqual([{ member: 'force_backup', grp: 'pg_read_all_data' }]);
  });

  it('backup: reads every table (also ones added later) and pg_dump works; cannot write, DDL, create or connect elsewhere', async () => {
    for (const sql of ['SELECT count(*) FROM account', 'SELECT count(*) FROM audit_log', 'SELECT count(*) FROM integration_outbox', 'SELECT count(*) FROM schema_migration']) {
      expect(await sqlState('force_backup', sql), sql).toBeUndefined();
    }
    await as(roleUrl('force_migrator'), 'CREATE TABLE t_backup_later (id int); CREATE TABLE pgboss.t_backup_later (id int)');
    expect(await sqlState('force_backup', 'SELECT * FROM pgboss.t_backup_later')).toBeUndefined();
    expect(await sqlState('force_backup', 'SELECT * FROM t_backup_later')).toBeUndefined();
    await as(roleUrl('force_migrator'), 'DROP TABLE t_backup_later; DROP TABLE pgboss.t_backup_later');
    for (const sql of [
      `INSERT INTO audit_log DEFAULT VALUES`,
      'UPDATE account SET email = email',
      'DELETE FROM session',
      'TRUNCATE session',
      'CREATE TABLE t_ddl (id int)',
      'CREATE TEMPORARY TABLE t_tmp (id int)',
      'CREATE SCHEMA s_ddl',
      'DROP TABLE account',
      'ALTER TABLE account ADD COLUMN x int',
      'CREATE TABLE pgboss.t_ddl (id int)',
    ]) {
      expect(await sqlState('force_backup', sql), sql).toBe(DENIED);
    }
    const dump = await pgc.container.exec(['pg_dump', '-h', 'localhost', '-U', 'force_backup', '-d', dbName, '--format=custom', '--no-owner', '--no-privileges', '--file=/tmp/backup-role.dump'], {
      env: { PGPASSWORD: PASSWORDS.force_backup },
    });
    expect(dump.exitCode, dump.output).toBe(0);
    const listed = await pgc.container.exec(['pg_restore', '--list', '/tmp/backup-role.dump']);
    expect(listed.exitCode, listed.output).toBe(0);
    expect(listed.output).toMatch(/TABLE public account/);
  });

  it('matches the documented privilege matrix table by table (and covers every table)', async () => {
    const tables = (await as<{ t: string }>(adminDbUrl, `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`)).map((r) => r.t);
    // A new table without a matrix line fails here: add it to EXPECTED and to db-roles.sql.
    expect(tables.sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const table of tables) {
      for (const [role, key] of [['force_api', 'api'], ['force_worker', 'worker']] as const) {
        const granted = (await as<{ p: string; ok: boolean }>(
          adminDbUrl,
          `SELECT p, has_table_privilege($1, 'public.' || quote_ident($2), p) AS ok FROM unnest($3::text[]) AS p`,
          [role, table, ALL_PRIVS],
        )).filter((r) => r.ok).map((r) => r.p);
        expect(granted.sort(), `${role} on ${table}`).toEqual([...EXPECTED[table]![key]].sort());
      }
    }
    // The migrator owns everything it created.
    const foreign = await as(adminDbUrl, `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'S', 'v') AND pg_get_userbyid(c.relowner) <> 'force_migrator'`);
    expect(foreign).toEqual([]);
  });

  it('api: reads and writes only its own data; cannot DDL, truncate, drop, alter or write the mirror', async () => {
    expect(await sqlState('force_api', 'SELECT count(*) FROM erp_customer')).toBeUndefined();
    expect(await sqlState('force_api', 'SELECT count(*) FROM session')).toBeUndefined();
    expect(await sqlState('force_api', `INSERT INTO auth_throttle (key, window_started_at) VALUES ('k', now())`)).toBeUndefined();
    expect(await sqlState('force_api', `DELETE FROM auth_throttle WHERE key = 'k'`)).toBeUndefined();
    for (const sql of [
      'CREATE TABLE t_ddl (id int)',
      'CREATE TEMPORARY TABLE t_tmp (id int)',
      'CREATE SCHEMA s_ddl',
      'DROP TABLE account',
      'ALTER TABLE account ADD COLUMN x int',
      'ALTER TABLE account DROP CONSTRAINT account_role_chk',
      'TRUNCATE session',
      'CREATE INDEX i_ddl ON account (email)',
      'CREATE EXTENSION IF NOT EXISTS pgcrypto',
      `INSERT INTO erp_customer DEFAULT VALUES`,
      `UPDATE erp_product SET description = 'x'`,
      'DELETE FROM erp_list_price',
      `UPDATE sync_state SET status = 'idle'`,
      'SELECT count(*) FROM audit_log',
      'UPDATE audit_log SET action = action',
      'DELETE FROM audit_log',
      'SELECT count(*) FROM integration_outbox',
      'SELECT count(*) FROM pgboss.job',
      'UPDATE schema_migration SET hash = hash',
      'DELETE FROM schema_migration',
    ]) {
      expect(await sqlState('force_api', sql), sql).toBe(DENIED);
    }
  });

  it('worker: writes the mirror and sync_state only; cannot read credentials/sessions/orders; cannot DDL', async () => {
    expect(await sqlState('force_worker', 'SELECT count(*) FROM erp_customer')).toBeUndefined();
    expect(await sqlState('force_worker', 'SELECT count(*) FROM installation_configuration_version')).toBeUndefined();
    expect(await sqlState('force_worker', `UPDATE sync_state SET status = status`)).toBeUndefined();
    expect(await sqlState('force_worker', 'UPDATE erp_product SET description = description')).toBeUndefined();
    // The mirror writer keeps a session-temporary table of the keys seen.
    expect(await sqlState('force_worker', 'CREATE TEMPORARY TABLE sf_seen (k0 int); TRUNCATE sf_seen')).toBeUndefined();
    for (const sql of [
      'SELECT count(*) FROM session',
      'SELECT count(*) FROM account',
      'SELECT count(*) FROM auth_throttle',
      'SELECT count(*) FROM audit_log',
      'SELECT count(*) FROM sales_order',
      'SELECT count(*) FROM customer_order_template',
      'SELECT count(*) FROM integration_outbox',
      'SELECT count(*) FROM schema_migration',
      'DELETE FROM erp_customer',
      'TRUNCATE erp_customer',
      'UPDATE installation_configuration_version SET is_current = is_current',
      'CREATE TABLE t_ddl (id int)',
      'CREATE SCHEMA s_ddl',
      'DROP TABLE erp_product',
      'ALTER TABLE erp_product ADD COLUMN x int',
      'DROP SCHEMA pgboss',
    ]) {
      expect(await sqlState('force_worker', sql), sql).toBe(DENIED);
    }
  });

  it('migrator: can migrate (re-run is a no-op), alter and create; tables it adds later start closed to api and worker', async () => {
    const again = await runMigrations(roleUrl('force_migrator'), { log: () => undefined });
    expect(again.applied).toEqual([]);
    expect(await sqlState('force_migrator', 'CREATE TABLE t_new (id int)')).toBeUndefined();
    expect(await sqlState('force_migrator', 'ALTER TABLE t_new ADD COLUMN x int')).toBeUndefined();
    expect(await sqlState('force_api', 'SELECT * FROM t_new')).toBe(DENIED);
    expect(await sqlState('force_worker', 'SELECT * FROM t_new')).toBe(DENIED);
    expect(await sqlState('force_migrator', 'DROP TABLE t_new')).toBeUndefined();
  });

  it('pgboss: objects the migrator installs later reach the worker through default privileges only', async () => {
    expect(await sqlState('force_migrator', 'CREATE TABLE pgboss.t_job (id int)')).toBeUndefined();
    expect(await sqlState('force_worker', 'INSERT INTO pgboss.t_job VALUES (1)')).toBeUndefined();
    expect(await sqlState('force_worker', 'DELETE FROM pgboss.t_job')).toBeUndefined();
    expect(await sqlState('force_worker', 'TRUNCATE pgboss.t_job')).toBe(DENIED);
    expect(await sqlState('force_worker', 'CREATE TABLE pgboss.t_ddl (id int)')).toBe(DENIED);
    expect(await sqlState('force_worker', 'DROP TABLE pgboss.t_job')).toBe(DENIED);
    expect(await sqlState('force_api', 'SELECT * FROM pgboss.t_job')).toBe(DENIED);
    await as(roleUrl('force_migrator'), 'DROP TABLE pgboss.t_job');
  });

  it('is idempotent: a second run leaves the same ACLs, and nobody else can connect', async () => {
    const acl = () => as(adminDbUrl, `SELECT n.nspname, c.relname, c.relacl::text AS acl FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public', 'pgboss') AND c.relkind = 'r' ORDER BY 1, 2`);
    const before = await acl();
    const run = await applyRolesSql(dbName);
    expect(run.exitCode).toBe(0);
    expect(await acl()).toEqual(before);

    await as(adminDbUrl, `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'someone_else') THEN CREATE ROLE someone_else LOGIN PASSWORD 'x'; END IF; END $$`);
    const u = new URL(roleUrl('force_api'));
    u.username = 'someone_else';
    u.password = 'x';
    await expect(as(u.toString(), 'SELECT 1')).rejects.toMatchObject({ code: DENIED });
  });

  it('stops before changing anything when a password variable is missing', async () => {
    const other = await pgc.createDatabase();
    const run = await applyRolesSql(new URL(other).pathname.slice(1), [], ['api_password']);
    expect(run.exitCode).not.toBe(0);
    expect(run.output).toMatch(/api_password/);
    expect(await as(other, `SELECT 1 FROM pg_namespace WHERE nspname = 'pgboss'`)).toEqual([]);
  });

  it('adopt_existing=on re-owns objects of a database created by another role', async () => {
    const adopted = await pgc.createDatabase();
    const name = new URL(adopted).pathname.slice(1);
    await as(adopted, 'CREATE TABLE legacy_owned (id int)');
    const run = await applyRolesSql(name, ['-v', 'adopt_existing=on']);
    expect(run.exitCode).toBe(0);
    expect(await as(adopted, `SELECT pg_get_userbyid(relowner) AS o FROM pg_class WHERE relname = 'legacy_owned'`)).toEqual([{ o: 'force_migrator' }]);
  });
});
