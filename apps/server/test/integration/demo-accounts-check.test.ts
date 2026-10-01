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
      const lines: { fields: object; message: string }[] = [];
      return { lines, warn: (fields: object, message: string) => lines.push({ fields, message }) };
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

    it('production, query failure: warns and boots', async () => {
      const log = logger();
      const broken = { select: () => { throw new Error('boom'); } } as never;
      await enforceDemoAccountsPolicy(broken, 'production', false, log);
      expect(log.lines).toHaveLength(1);
    });
  });
});
