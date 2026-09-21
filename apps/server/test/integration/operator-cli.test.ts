import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { account, auditLog, session } from '@salesforce/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_PASSWORD } from '../helpers/auth.js';
import { login, startAuthApp } from '../helpers/auth-app.js';
import { createMigratedDatabase, startPostgres, type TestPostgres } from '../helpers/postgres.js';

const run = promisify(execFile);
const SERVER_ROOT = new URL('../..', import.meta.url);

/**
 * Runs `src/<script>` as a real child process with an exactly controlled environment (nothing is
 * inherited, so no developer `.env` or CI variable can make a guard look satisfied).
 */
async function runScript(
  script: string,
  env: Record<string, string>,
  args: string[] = [],
  input?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = run(process.execPath, ['--import', 'tsx', `src/${script}`, ...args], {
    cwd: SERVER_ROOT,
    env: { PATH: process.env['PATH'] ?? '', SystemRoot: process.env['SystemRoot'] ?? '', ...env },
    timeout: 60_000,
  });
  if (input !== undefined) child.child.stdin?.end(input);
  try {
    const { stdout, stderr } = await child;
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof failure.code === 'number' ? failure.code : 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

const REMOTE_URL = 'postgres://user:pw@db.internal.example.com:5432/salesforce';
const LOOPBACK_URL = 'postgres://user:pw@127.0.0.1:1/none'; // nothing listens: only a guard failure can be the reason
const FAST_HASH = { PASSWORD_HASH_MEMORY_KIB: '19456' };
const SEED_PASSWORD = 'Seed-Only-Passphrase-93';

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];

beforeAll(async () => {
  postgres = await startPostgres();
}, 120_000);

afterAll(async () => {
  for (const close of opened.reverse()) await close();
  await postgres.stop();
});

describe('seed guards (fail closed, before touching the database)', () => {
  it('refuses when NODE_ENV is not set: there is no development default', async () => {
    const result = await runScript('seed.ts', { DATABASE_URL: LOOPBACK_URL, SEED_DEV_PASSWORD: SEED_PASSWORD });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/NODE_ENV/);
  }, 90_000);

  it('refuses NODE_ENV=production', async () => {
    const result = await runScript('seed.ts', { NODE_ENV: 'production', DATABASE_URL: LOOPBACK_URL, SEED_DEV_PASSWORD: SEED_PASSWORD });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/production/);
  }, 90_000);

  it('refuses a database that is not on the loopback interface', async () => {
    const result = await runScript('seed.ts', { NODE_ENV: 'development', DATABASE_URL: REMOTE_URL, SEED_DEV_PASSWORD: SEED_PASSWORD });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/loopback/);
    expect(result.stderr).not.toContain('user:pw'); // the connection string (credentials) is never echoed
  }, 90_000);

  it('refuses without SEED_DEV_PASSWORD: no fallback password exists', async () => {
    const result = await runScript('seed.ts', { NODE_ENV: 'development', DATABASE_URL: LOOPBACK_URL });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/SEED_DEV_PASSWORD/);
  }, 90_000);

  it('refuses a seed password that breaks the password policy, without printing it', async () => {
    const weak = 'weak-seed';
    const result = await runScript('seed.ts', { NODE_ENV: 'development', DATABASE_URL: LOOPBACK_URL, SEED_DEV_PASSWORD: weak });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/SEED_DEV_PASSWORD/);
    expect(result.stderr + result.stdout).not.toContain(weak);
  }, 90_000);
});

describe('account CLI guards', () => {
  const base = { ACCOUNT_PASSWORD: TEST_PASSWORD };
  const create = ['create', '--email', 'a@example.test', '--name', 'A', '--role', 'admin'];

  it('refuses when NODE_ENV is not set', async () => {
    const result = await runScript('account-cli.ts', { ...base, DATABASE_URL: LOOPBACK_URL }, create);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/NODE_ENV/);
  }, 90_000);

  it('refuses a non-loopback database unless the operator opts in explicitly', async () => {
    const result = await runScript('account-cli.ts', { ...base, NODE_ENV: 'development', DATABASE_URL: REMOTE_URL }, create);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/ALLOW_REMOTE_DB/);
  }, 90_000);

  it('never takes the password from the command line', async () => {
    const result = await runScript(
      'account-cli.ts',
      { NODE_ENV: 'development', DATABASE_URL: LOOPBACK_URL },
      [...create, '--password', TEST_PASSWORD],
    );
    expect(result.code).not.toBe(0);
    expect(result.stderr).not.toContain(TEST_PASSWORD);
  }, 90_000);
});

describe('seed and account CLI against a disposable database', () => {
  it('seeds demo accounts with the given password, never printing it, and is idempotent', async () => {
    const database = await createMigratedDatabase(postgres);
    opened.push(() => database.handle.close());
    const env = { NODE_ENV: 'development', DATABASE_URL: database.url, SEED_DEV_PASSWORD: SEED_PASSWORD, ...FAST_HASH };

    const first = await runScript('seed.ts', env);
    expect(first.code, first.stderr).toBe(0);
    expect(first.stdout + first.stderr).not.toContain(SEED_PASSWORD);
    expect(first.stdout).toMatch(/demo accounts: 4 created/);

    const second = await runScript('seed.ts', env);
    expect(second.code, second.stderr).toBe(0);
    expect(second.stdout).toMatch(/demo accounts: 0 created, 4 already present/);

    // The password is the given one, and the account can log in through the real API.
    const rows = await database.handle.db.select().from(account);
    expect(rows).toHaveLength(4);
    expect(JSON.stringify(rows)).not.toContain(SEED_PASSWORD);
    const admin = rows.find((row) => row.role === 'admin');
    const ctx = await startAuthApp(postgres, opened, { database });
    const response = await login(ctx, admin?.email ?? '', SEED_PASSWORD);
    expect(response.statusCode).toBe(200);
  }, 180_000);

  it('creates an account from ACCOUNT_PASSWORD or stdin, audits it without the password, and enforces the policy', async () => {
    const database = await createMigratedDatabase(postgres);
    opened.push(() => database.handle.close());
    const env = { NODE_ENV: 'development', DATABASE_URL: database.url, ...FAST_HASH };

    const weak = await runScript('account-cli.ts', { ...env, ACCOUNT_PASSWORD: 'short' }, ['create', '--email', 'w@example.test', '--name', 'W', '--role', 'admin']);
    expect(weak.code).not.toBe(0);
    expect(weak.stderr).toMatch(/senha/i);

    const viaEnv = await runScript('account-cli.ts', { ...env, ACCOUNT_PASSWORD: TEST_PASSWORD }, ['create', '--email', 'env@example.test', '--name', 'Env', '--role', 'admin']);
    expect(viaEnv.code, viaEnv.stderr).toBe(0);
    expect(viaEnv.stdout + viaEnv.stderr).not.toContain(TEST_PASSWORD);

    const viaStdin = await runScript('account-cli.ts', env, ['create', '--email', 'in@example.test', '--name', 'In', '--role', 'manager', '--password-stdin'], `${TEST_PASSWORD}\n`);
    expect(viaStdin.code, viaStdin.stderr).toBe(0);

    const duplicate = await runScript('account-cli.ts', { ...env, ACCOUNT_PASSWORD: TEST_PASSWORD }, ['create', '--email', 'ENV@example.test', '--name', 'Dup', '--role', 'admin']);
    expect(duplicate.code).not.toBe(0);

    const audits = await database.handle.db.select().from(auditLog).where(eq(auditLog.action, 'account.created'));
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toContain(TEST_PASSWORD);

    const ctx = await startAuthApp(postgres, opened, { database });
    expect((await login(ctx, 'env@example.test', TEST_PASSWORD)).statusCode).toBe(200);
    expect((await login(ctx, 'in@example.test', TEST_PASSWORD)).statusCode).toBe(200);
  }, 240_000);

  it('set-password ends every session of the account; unlock clears a lockout', async () => {
    const database = await createMigratedDatabase(postgres);
    opened.push(() => database.handle.close());
    const env = { NODE_ENV: 'development', DATABASE_URL: database.url, ...FAST_HASH };
    const created = await runScript('account-cli.ts', { ...env, ACCOUNT_PASSWORD: TEST_PASSWORD }, ['create', '--email', 'p@example.test', '--name', 'P', '--role', 'seller']);
    expect(created.code, created.stderr).toBe(0);

    const ctx = await startAuthApp(postgres, opened, { database });
    expect((await login(ctx, 'p@example.test', TEST_PASSWORD)).statusCode).toBe(200);

    const next = 'Another-Sturdy-Passphrase-77';
    const changed = await runScript('account-cli.ts', { ...env, ACCOUNT_PASSWORD: next }, ['set-password', '--email', 'p@example.test']);
    expect(changed.code, changed.stderr).toBe(0);

    const [row] = await database.handle.db.select().from(account).where(eq(account.email, 'p@example.test'));
    const sessions = await database.handle.db.select().from(session).where(eq(session.accountId, row?.id ?? ''));
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((entry) => entry.revokedAt !== null)).toBe(true);
    expect((await login(ctx, 'p@example.test', TEST_PASSWORD)).statusCode).toBe(401);
    expect((await login(ctx, 'p@example.test', next)).statusCode).toBe(200);

    const unlocked = await runScript('account-cli.ts', env, ['unlock', '--email', 'p@example.test']);
    expect(unlocked.code, unlocked.stderr).toBe(0);
  }, 240_000);

  it('attributes every operator action in the audit trail: OPERATOR when set, otherwise the OS user', async () => {
    const database = await createMigratedDatabase(postgres);
    opened.push(() => database.handle.close());
    const env = { NODE_ENV: 'development', DATABASE_URL: database.url, ACCOUNT_PASSWORD: TEST_PASSWORD, ...FAST_HASH };

    const named = await runScript('account-cli.ts', { ...env, OPERATOR: 'maria.ops' }, ['create', '--email', 'a1@example.test', '--name', 'A1', '--role', 'admin']);
    expect(named.code, named.stderr).toBe(0);
    const anonymous = await runScript('account-cli.ts', env, ['create', '--email', 'a2@example.test', '--name', 'A2', '--role', 'admin']);
    expect(anonymous.code, anonymous.stderr).toBe(0);
    const unlock = await runScript('account-cli.ts', { ...env, OPERATOR: 'maria.ops' }, ['unlock', '--email', 'a1@example.test']);
    expect(unlock.code, unlock.stderr).toBe(0);

    const rows = await database.handle.db.select().from(auditLog);
    const operators = (action: string) => rows.filter((row) => row.action === action).map((row) => (row.detail as { operator?: string }).operator);
    const created = operators('account.created');
    expect(created).toContain('maria.ops');
    expect(created.filter((operator) => operator?.startsWith('os:'))).toHaveLength(1);
    expect(operators('auth.unlock')).toEqual(['maria.ops']);
    expect(JSON.stringify(rows)).not.toContain(TEST_PASSWORD);

    const invalid = await runScript('account-cli.ts', { ...env, OPERATOR: 'x'.repeat(200) }, ['unlock', '--email', 'a1@example.test']);
    expect(invalid.code).not.toBe(0);
    expect(invalid.stderr).toMatch(/OPERATOR/);
  }, 240_000);

  it('records the operator on the seed accounts too', async () => {
    const database = await createMigratedDatabase(postgres);
    opened.push(() => database.handle.close());
    const seeded = await runScript('seed.ts', { NODE_ENV: 'development', DATABASE_URL: database.url, SEED_DEV_PASSWORD: SEED_PASSWORD, OPERATOR: 'seed-runner', ...FAST_HASH });
    expect(seeded.code, seeded.stderr).toBe(0);
    const created = (await database.handle.db.select().from(auditLog)).filter((row) => row.action === 'account.created');
    expect(created.length).toBeGreaterThan(0);
    expect(created.every((row) => (row.detail as { operator?: string }).operator === 'seed-runner')).toBe(true);
  }, 240_000);
});
