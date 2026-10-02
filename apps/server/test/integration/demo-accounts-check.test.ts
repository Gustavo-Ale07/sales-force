import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoAccountsWarning, enforceDemoAccountsPolicy, isDemoAccountEmail } from '../../src/platform/demo-accounts-check.js';
import { createTestAccount } from '../helpers/auth.js';
import { createMigratedDatabase, startPostgres, type MigratedDatabase, type TestPostgres } from '../helpers/postgres.js';

/** F12: a production start warns (never fails) when demo accounts exist. */

describe('isDemoAccountEmail', () => {
  it.each([
    ['admin@demo.salesforce.local', true],
    ['x@a.demo.salesforce.local', true],
    ['ADMIN@Demo.Salesforce.Local', true],
    ['x@demo.salesforce.local.evil.com', false],
    ['x@notdemo.salesforce.local', false],
    ['x@example.test', false],
  ])('%s -> %s', (email, expected) => {
    expect(isDemoAccountEmail(email)).toBe(expected);
  });
});

describe('demoAccountsWarning', () => {
  let postgres: TestPostgres;
  let database: MigratedDatabase;
  beforeAll(async () => {
    postgres = await startPostgres();
    database = await createMigratedDatabase(postgres);
    await createTestAccount(database.handle, { email: 'admin@demo.salesforce.local', role: 'admin' });
    await createTestAccount(database.handle, { email: 'real@empresa.example', role: 'manager' });
  });
  afterAll(async () => {
    await database.handle.close();
    await postgres.stop();
  });

  it('in production: reports the count and never the e-mails', async () => {
    const result = await demoAccountsWarning(database.handle.db, 'production');
    expect(result).toEqual({ count: 1 });
  });

  it('outside production: no check at all', async () => {
    expect(await demoAccountsWarning(database.handle.db, 'development')).toBeNull();
  });

  it('a failing query yields null instead of breaking startup', async () => {
    const broken = { select: () => { throw new Error('boom'); } } as never;
    expect(await demoAccountsWarning(broken, 'production')).toBeNull();
  });

  describe('enforceDemoAccountsPolicy', () => {
    const logger = () => {
      const lines: { level: 'warn' | 'error'; fields: object; message: string }[] = [];
      return {
        lines,
        warn: (fields: object, message: string) => lines.push({ level: 'warn', fields, message }),
        error: (fields: object, message: string) => lines.push({ level: 'error', fields, message }),
      };
    };

    it('production with a demo account: refuses to boot, naming no e-mail', async () => {
      const log = logger();
      const error = await enforceDemoAccountsPolicy(database.handle.db, 'production', false, log).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('refusing to start');
      expect((error as Error).message).not.toContain('admin@');
    });

    it('production with a demo account and the explicit override: boots with a warning', async () => {
      const log = logger();
      await enforceDemoAccountsPolicy(database.handle.db, 'production', true, log);
      expect(log.lines).toHaveLength(1);
      expect(log.lines[0]?.fields).toEqual({ demoAccounts: 1 });
    });

    it('development: no check, no refusal (dev compose unaffected)', async () => {
      const log = logger();
      await enforceDemoAccountsPolicy(database.handle.db, 'development', false, log);
      expect(log.lines).toHaveLength(0);
    });

    it('production, query failure: refuses to boot (fail closed) without exposing driver details', async () => {
      const log = logger();
      const broken = { select: () => { throw new Error('password authentication failed for user "pg_secret_user" at 10.0.0.5'); } } as never;
      const error = await enforceDemoAccountsPolicy(broken, 'production', false, log).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('refusing to start');
      for (const needle of ['pg_secret_user', '10.0.0.5', 'password authentication']) {
        expect((error as Error).message).not.toContain(needle);
        expect(JSON.stringify(log.lines)).not.toContain(needle);
      }
      expect(log.lines.some((line) => line.level === 'error')).toBe(true);
    });

    it.each([
      ['a Node error code', Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' }), 'ECONNREFUSED'],
      ['a SQLSTATE on the wrapped cause', new Error('Failed query: select ... host=db.internal', { cause: Object.assign(new Error('password authentication failed for user "pg_secret_user"'), { code: '28P01' }) }), '28P01'],
    ])('production, query failure: logs only the allow-listed code (%s), never driver text', async (_label, thrown, expected) => {
      const log = logger();
      const broken = { select: () => { throw thrown; } } as never;
      await enforceDemoAccountsPolicy(broken, 'production', false, log).catch(() => undefined);
      const errorLine = log.lines.find((line) => line.level === 'error');
      expect(errorLine?.fields).toMatchObject({ errorCode: expected });
      for (const needle of ['pg_secret_user', '10.0.0.5', 'db.internal', 'password authentication', 'Failed query']) {
        expect(JSON.stringify(log.lines)).not.toContain(needle);
      }
    });

    it('production, query failure: a code that does not match the allow-list shape is dropped', async () => {
      const log = logger();
      const broken = { select: () => { throw Object.assign(new Error('x'), { code: 'host db.internal: refused' }); } } as never;
      await enforceDemoAccountsPolicy(broken, 'production', false, log).catch(() => undefined);
      const errorLine = log.lines.find((line) => line.level === 'error');
      expect(errorLine?.fields).not.toHaveProperty('errorCode');
      expect(JSON.stringify(log.lines)).not.toContain('db.internal');
    });

    it('production, query failure with the explicit override: boots with a clear warning', async () => {
      const log = logger();
      const broken = { select: () => { throw new Error('boom'); } } as never;
      await enforceDemoAccountsPolicy(broken, 'production', true, log);
      expect(log.lines.filter((line) => line.level === 'warn')).toHaveLength(1);
      expect(log.lines.find((line) => line.level === 'warn')?.message).toContain('NOT verified');
    });

    it('production, check ok and no demo account: boots silently', async () => {
      const clean = await createMigratedDatabase(postgres);
      try {
        const log = logger();
        await enforceDemoAccountsPolicy(clean.handle.db, 'production', false, log);
        expect(log.lines).toHaveLength(0);
      } finally {
        await clean.handle.close();
      }
    });
  });
});
