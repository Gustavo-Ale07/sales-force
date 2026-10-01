import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoAccountsWarning, isDemoAccountEmail } from '../../src/platform/demo-accounts-check.js';
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
});
