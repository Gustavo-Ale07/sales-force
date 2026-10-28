import { account, session } from '@salesforce/db';
import { eq } from 'drizzle-orm';
import { createOperatorAccountService } from '../../src/cli/operator.js';
import { openSessionCookie } from '../helpers/auth-app.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../src/http/app-error.js';
import { AccountRepository } from '../../src/iam/account.repository.js';
import { AuditService } from '../../src/iam/audit.service.js';
import { LOCAL_MODE_ROLES, withExternalSellerLogin } from '../../src/iam/auth-config.js';
import { AuthService } from '../../src/iam/auth.service.js';
import { CredentialSecret } from '../../src/iam/external-identity.js';
import { DrizzleExternalAccountLinks } from '../../src/iam/drizzle-external-account-links.js';
import { Argon2idPasswordHasher } from '../../src/iam/password-hasher.js';
import { SessionRepository } from '../../src/iam/session.repository.js';
import { ThrottleRepository } from '../../src/iam/throttle.repository.js';
import { createLogger } from '../../src/observability/logger.js';
import { TestClock, createTestAccount, testAuthConfig, tokenOf, TEST_HASH_PARAMS, TEST_PASSWORD, WRONG_PASSWORD } from '../helpers/auth.js';
import { FakeExternalIdentityVerifier } from '../helpers/external-identity.js';
import { captureLogs, closeAllThenStop, createMigratedDatabase, startPostgres, type TestPostgres } from '../helpers/postgres.js';

/** PB-1 · AUTH_MODE=external: operational users only through the verifier, local Argon2id for admin/technical only. */
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
beforeAll(async () => {
  postgres = await startPostgres();
});
afterEach(async () => {
  await closeAllThenStop(opened.splice(0), undefined);
});
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const META = { ip: '203.0.113.9', userAgent: 'vitest', requestId: 'req-1' } as const;

async function setup(options: { mode?: 'dev' | 'external' } = {}) {
  const database = await createMigratedDatabase(postgres);
  opened.push(() => database.handle.close());
  const db = database.handle.db;
  const clock = new TestClock();
  const logger = createLogger({ level: 'debug', service: 'api', destination: captureLogs().stream });
  const config =
    options.mode === 'dev'
      ? testAuthConfig()
      : withExternalSellerLogin(testAuthConfig({ authMode: 'external', allowedRoles: LOCAL_MODE_ROLES }), {
          enabled: true,
          verifyTimeoutMs: 200,
          minFailureMs: 0,
          verifier: { url: 'http://verifier.invalid:3002', sharedSecret: new CredentialSecret('synthetic-secret-of-at-least-32-characters') },
        });
  const verifier = new FakeExternalIdentityVerifier();
  const audit = new AuditService(db, clock.fn);
  const service = new AuthService(
    config,
    new Argon2idPasswordHasher(config.passwordHash),
    new AccountRepository(db),
    new SessionRepository(db),
    new ThrottleRepository(db),
    audit,
    clock.fn,
    logger,
    verifier,
    new DrizzleExternalAccountLinks(db, audit),
  );
  return { database, db, clock, service, verifier };
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error('expected a failure');
}

describe('AUTH_MODE=external login policy', () => {
  it('opens a local session for admin and technical without any directory call, and reports authMode external', async () => {
    const ctx = await setup();
    await createTestAccount(ctx.database.handle, { username: 'adm', role: 'admin' }, ctx.clock.fn);
    await createTestAccount(ctx.database.handle, { username: 'tec', role: 'technical' }, ctx.clock.fn);
    for (const username of ['adm', 'tec']) {
      const result = await ctx.service.login({ username, password: TEST_PASSWORD }, META);
      expect(ctx.service.toSessionBody(result.user).authMode).toBe('external');
    }
    expect(ctx.verifier.calls).toEqual([]);
    expect(await ctx.db.select().from(session)).toHaveLength(2);
  });

  it('a wrong admin password is final: it is never forwarded to the directory', async () => {
    const ctx = await setup();
    await createTestAccount(ctx.database.handle, { username: 'adm', role: 'admin' }, ctx.clock.fn);
    expect((await failure(ctx.service.login({ username: 'adm', password: WRONG_PASSWORD }, META))).code).toBe('invalid_credentials');
    expect(ctx.verifier.calls).toEqual([]);
  });

  it('a local manager, with a wrong or the correct password, is refused without any directory call', async () => {
    const ctx = await setup();
    await createTestAccount(ctx.database.handle, { username: 'mgr', role: 'manager' }, ctx.clock.fn);
    for (const password of [WRONG_PASSWORD, TEST_PASSWORD]) {
      expect((await failure(ctx.service.login({ username: 'mgr', password }, META))).code).toBe('invalid_credentials');
    }
    expect(ctx.verifier.calls).toEqual([]);
    expect(await ctx.db.select().from(session)).toHaveLength(0);
  });

  it('AUTH-6 ruling A: a seller session that is not external stops resolving; an external seller session still resolves', async () => {
    const ctx = await setup();
    const seller = await createTestAccount(ctx.database.handle, { username: 'sel', role: 'seller' }, ctx.clock.fn);
    const token = tokenOf(await openSessionCookie(ctx.database, seller.id, ctx.clock.fn()));
    expect(await ctx.service.resolveSession(token)).toBeNull();
    await ctx.db.update(account).set({ externalUserId: '4501' }).where(eq(account.id, seller.id));
    expect((await ctx.service.resolveSession(token))?.user).toMatchObject({ role: 'seller' });
  });

  it('the same ruling holds with no mode restriction (dev): a local-password seller session never resolves', async () => {
    const ctx = await setup({ mode: 'dev' });
    const seller = await createTestAccount(ctx.database.handle, { username: 'sel', role: 'seller' }, ctx.clock.fn);
    const token = tokenOf(await openSessionCookie(ctx.database, seller.id, ctx.clock.fn()));
    expect(await ctx.service.resolveSession(token)).toBeNull();
  });

  it('AccountService refuses to create a local seller or manager in external mode, and still allows admin/technical and other modes', async () => {
    const ctx = await setup();
    const input = (username: string, role: 'seller' | 'manager' | 'admin' | 'technical') => ({ username, displayName: 'X', password: TEST_PASSWORD, role });
    const strict = createOperatorAccountService(ctx.database.handle, TEST_HASH_PARAMS, ctx.clock.fn, undefined, 'external').accounts;
    await expect(strict.createAccount(input('s1', 'seller'))).rejects.toThrow(/create-external/);
    await expect(strict.createAccount(input('m1', 'manager'))).rejects.toThrow(/create-external/);
    await strict.createAccount(input('a1', 'admin'));
    await strict.createAccount(input('t1', 'technical'));
    for (const mode of [undefined, 'dev', 'local'] as const) {
      const lax = createOperatorAccountService(ctx.database.handle, TEST_HASH_PARAMS, ctx.clock.fn, undefined, mode).accounts;
      await lax.createAccount(input(`s-${mode ?? 'unset'}`, 'seller'));
    }
  });

  it('never opens a session from a valid local password of a manager or a seller', async () => {
    const ctx = await setup();
    await createTestAccount(ctx.database.handle, { username: 'mgr', role: 'manager' }, ctx.clock.fn);
    await createTestAccount(ctx.database.handle, { username: 'sel', role: 'seller' }, ctx.clock.fn);
    for (const username of ['mgr', 'sel']) {
      expect((await failure(ctx.service.login({ username, password: TEST_PASSWORD }, META))).code).toBe('invalid_credentials');
    }
    expect(await ctx.db.select().from(session)).toHaveLength(0);
  });

  it('refuses a new operational login (503, no fallback) while the verifier is unavailable', async () => {
    const ctx = await setup();
    ctx.verifier.forced = { fail: 'unavailable' };
    expect((await failure(ctx.service.login({ username: 'plac123', password: 'whatever-Pass-1' }, META))).code).toBe('service_unavailable');
    expect(await ctx.db.select().from(session)).toHaveLength(0);
  });
});
