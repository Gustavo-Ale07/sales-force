import { account, auditLog, authThrottle, session } from '@salesforce/db';
import { resolveCustomerScopeOutcome } from '@salesforce/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOperatorAccountService } from '../../src/cli/operator.js';
import { AppError } from '../../src/http/app-error.js';
import { AccountRepository } from '../../src/iam/account.repository.js';
import { AuditService } from '../../src/iam/audit.service.js';
import { AuthService } from '../../src/iam/auth.service.js';
import { Argon2idPasswordHasher } from '../../src/iam/password-hasher.js';
import { toScopeActor } from '../../src/iam/policy.js';
import { SessionRepository } from '../../src/iam/session.repository.js';
import { ThrottleRepository } from '../../src/iam/throttle.repository.js';
import { createLogger } from '../../src/observability/logger.js';
import { DEMO_CONFIGURATION } from '@salesforce/sankhya';
import { storeConfiguration } from '../helpers/commercial-fixture.js';
import { TestClock, createTestAccount, testAuthConfig, TEST_HASH_PARAMS } from '../helpers/auth.js';
import { FakeExternalIdentityVerifier, InMemoryExternalAccountLinks } from '../helpers/external-identity.js';
import { captureLogs, createMigratedDatabase, startPostgres, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];

beforeAll(async () => {
  postgres = await startPostgres();
});

afterAll(async () => {
  for (const close of opened.reverse()) await close();
  await postgres.stop();
});

const META = { ip: '203.0.113.9', userAgent: 'vitest', requestId: 'req-1' } as const;
const EXT_PASSWORD = 'Ext-Directory-Passphrase-99';

async function setup(options: { enabled?: boolean; wire?: boolean; maxFailures?: number } = {}) {
  const database = await createMigratedDatabase(postgres);
  opened.push(() => database.handle.close());
  const db = database.handle.db;
  const clock = new TestClock();
  const capture = captureLogs();
  const logger = createLogger({ level: 'debug', service: 'api', destination: capture.stream });
  const base = testAuthConfig();
  const config = testAuthConfig({
    ...(options.enabled === false ? {} : { externalLogin: { enabled: true, verifyTimeoutMs: 200, minFailureMs: 0 } }),
    ...(options.maxFailures === undefined
      ? {}
      : { throttle: { ...base.throttle, account: { ...base.throttle.account, maxFailures: options.maxFailures } } }),
  });
  const verifier = new FakeExternalIdentityVerifier();
  const links = new InMemoryExternalAccountLinks();
  const wired = options.wire !== false;
  const service = new AuthService(
    config,
    new Argon2idPasswordHasher(config.passwordHash),
    new AccountRepository(db),
    new SessionRepository(db),
    new ThrottleRepository(db),
    new AuditService(db, clock.fn),
    clock.fn,
    logger,
    wired ? verifier : undefined,
    wired ? links : undefined,
  );
  return { database, db, clock, capture, service, verifier, links };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

/** A Force account + a directory user + the explicit link between them. */
async function provision(ctx: Ctx, opts: { email: string; login: string; role?: 'seller' | 'manager' | 'admin'; sellerCode?: number | null; active?: boolean; directorySeller?: number | null }) {
  const created = await createTestAccount(ctx.database.handle, { email: opts.email, role: opts.role ?? 'seller' }, ctx.clock.fn);
  if (opts.sellerCode !== undefined && opts.sellerCode !== null) {
    const configVersionId = await storeConfiguration(ctx.database.handle);
    const { accounts } = createOperatorAccountService(ctx.database.handle, TEST_HASH_PARAMS, ctx.clock.fn);
    await accounts.linkSeller(created.id, opts.sellerCode, configVersionId);
  }
  const externalUserId = `ext-${opts.login}`;
  ctx.verifier.users.set(opts.login, {
    password: EXT_PASSWORD,
    identity: {
      externalUserId,
      displayName: 'Directory Name',
      sellerCode: opts.directorySeller === undefined ? (opts.sellerCode ?? null) : opts.directorySeller,
      active: opts.active ?? true,
    },
  });
  ctx.links.links.set(externalUserId, created.id);
  return created;
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

const audit = async (ctx: Ctx, action?: string) => {
  const rows = await ctx.db.select().from(auditLog);
  return action === undefined ? rows : rows.filter((row) => row.action === action);
};

describe('AuthService.loginExternal', () => {
  it('opens a new opaque session for a mapped, active, linked account', async () => {
    const ctx = await setup();
    const acc = await provision(ctx, { email: 'ana@example.test', login: 'ANA', sellerCode: 103 });

    const first = await ctx.service.loginExternal({ login: 'ANA', password: EXT_PASSWORD }, META);
    const second = await ctx.service.loginExternal({ login: 'ANA', password: EXT_PASSWORD }, META);

    expect(first.user).toMatchObject({ accountId: acc.id, role: 'seller', sellerCodes: [103], channel: 'web' });
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.token).not.toBe(first.token);
    expect(second.user.sessionId).not.toBe(first.user.sessionId);
    expect(await ctx.db.select().from(session)).toHaveLength(2);
    const [success] = await audit(ctx, 'auth.login.success');
    expect(success?.actorAccountId).toBe(acc.id);
    expect(success?.detail).toMatchObject({ method: 'external' });
    // The verifier got an opaque secret, never a plain string.
    expect(ctx.verifier.calls.every((call) => call.passwordWasSecret)).toBe(true);
    expect(JSON.stringify(ctx.verifier.lastPasswordObject)).not.toContain(EXT_PASSWORD);
  });

  it('answers a wrong password with the uniform invalid_credentials and opens no session', async () => {
    const ctx = await setup();
    await provision(ctx, { email: 'ana@example.test', login: 'ANA', sellerCode: 103 });
    const err = await failure(ctx.service.loginExternal({ login: 'ANA', password: 'nope-nope-nope' }, META));
    expect(err.code).toBe('invalid_credentials');
    expect(err.status).toBe(401);
    expect(await ctx.db.select().from(session)).toHaveLength(0);
    const [row] = await audit(ctx, 'auth.login.failure');
    expect(row?.detail).toMatchObject({ reason: 'external_invalid_credentials' });
  });

  it('gives the same client-visible error for wrong password, unmapped, inactive and disabled accounts', async () => {
    const ctx = await setup();
    await provision(ctx, { email: 'a@example.test', login: 'A' });
    await provision(ctx, { email: 'b@example.test', login: 'B', active: false });
    const disabled = await provision(ctx, { email: 'c@example.test', login: 'C' });
    await ctx.db.update(account).set({ status: 'disabled' }).where(eq(account.id, disabled.id));
    ctx.verifier.users.set('D', { password: EXT_PASSWORD, identity: { externalUserId: 'ext-D', displayName: 'D', sellerCode: null, active: true } });

    const errors = await Promise.all([
      failure(ctx.service.loginExternal({ login: 'A', password: 'wrong-wrong' }, { ...META, ip: '10.0.0.1' })),
      failure(ctx.service.loginExternal({ login: 'B', password: EXT_PASSWORD }, { ...META, ip: '10.0.0.2' })),
      failure(ctx.service.loginExternal({ login: 'C', password: EXT_PASSWORD }, { ...META, ip: '10.0.0.3' })),
      failure(ctx.service.loginExternal({ login: 'D', password: EXT_PASSWORD }, { ...META, ip: '10.0.0.4' })),
    ]);
    expect(new Set(errors.map((e) => `${e.code}|${e.message}|${e.status}`)).size).toBe(1);
    const reasons = (await audit(ctx, 'auth.login.failure')).map((row) => (row.detail as { reason: string }).reason).sort();
    expect(reasons).toEqual(['external_account_disabled', 'external_inactive', 'external_invalid_credentials', 'external_unmapped']);
    expect(await ctx.db.select().from(session)).toHaveLength(0);
  });

  it('treats a verifier-reported unmapped user as invalid_credentials', async () => {
    const ctx = await setup();
    ctx.verifier.forced = { fail: 'unmapped' };
    const err = await failure(ctx.service.loginExternal({ login: 'X', password: EXT_PASSWORD }, META));
    expect(err.code).toBe('invalid_credentials');
  });

  it.each(['unavailable', 'throw', 'hang'] as const)('fails closed with 503 and no session when the verifier is %s', async (mode) => {
    const ctx = await setup();
    await provision(ctx, { email: 'ana@example.test', login: 'ANA', sellerCode: 103 });
    // A local hash exists for this account (createTestAccount): it must never be used as a fallback.
    ctx.verifier.forced = mode === 'unavailable' ? { fail: 'unavailable' } : mode;
    const err = await failure(ctx.service.loginExternal({ login: 'ANA', password: 'Sturdy-Test-Passphrase-42' }, META));
    expect(err.code).toBe('service_unavailable');
    expect(err.status).toBe(503);
    expect(await ctx.db.select().from(session)).toHaveLength(0);
    // An outage is not a credential failure: it must not feed the lockout counters.
    const keys = (await ctx.db.select().from(authThrottle)).map((row) => row.key);
    expect(keys.filter((key) => key.startsWith('extlogin:'))).toEqual([]);
  });

  it('maps a verifier rate limit to 429 without counting it as a failed login', async () => {
    const ctx = await setup();
    ctx.verifier.forced = { fail: 'rate_limited' };
    const err = await failure(ctx.service.loginExternal({ login: 'ANA', password: EXT_PASSWORD }, META));
    expect(err.code).toBe('rate_limited');
    expect(err.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(await ctx.db.select().from(authThrottle)).toHaveLength(0);
  });

  it('locks before calling the verifier: a locked login does not reach the directory', async () => {
    const ctx = await setup({ maxFailures: 3 });
    await provision(ctx, { email: 'ana@example.test', login: 'ANA', sellerCode: 103 });
    for (let i = 0; i < 3; i += 1) {
      await failure(ctx.service.loginExternal({ login: 'ANA', password: 'bad-bad-bad' }, META));
    }
    expect(ctx.verifier.calls).toHaveLength(3);

    const blocked = await failure(ctx.service.loginExternal({ login: 'ANA', password: EXT_PASSWORD }, META));
    expect(blocked.code).toBe('rate_limited');
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(ctx.verifier.calls).toHaveLength(3); // the correct password never reached the verifier
    expect((await audit(ctx, 'auth.login.blocked')).length).toBeGreaterThanOrEqual(1);

    // The lock expires with the clock.
    ctx.clock.advance(16 * 60_000);
    const ok = await ctx.service.loginExternal({ login: 'ANA', password: EXT_PASSWORD }, META);
    expect(ok.user.sellerCodes).toEqual([103]);
  });

  it('locks per address and on the installation-wide budget before calling the verifier', async () => {
    const ctx = await setup();
    await provision(ctx, { email: 'ana@example.test', login: 'ANA' });
    for (let i = 0; i < 20; i += 1) {
      await failure(ctx.service.loginExternal({ login: `ghost${i}`, password: 'bad-bad-bad' }, META));
    }
    const before = ctx.verifier.calls.length;
    const blocked = await failure(ctx.service.loginExternal({ login: 'ANA', password: EXT_PASSWORD }, META));
    expect(blocked.code).toBe('rate_limited');
    expect(ctx.verifier.calls).toHaveLength(before);

    const tight = await setup();
    await provision(tight, { email: 'ana@example.test', login: 'ANA' });
    const tightService = new AuthService(
      testAuthConfig({
        externalLogin: { enabled: true, verifyTimeoutMs: 200, minFailureMs: 0 },
        login: { maxConcurrentHashes: 8, globalMaxFailuresPerMinute: 2, blockedAuditWindowMs: 60_000 },
      }),
      new Argon2idPasswordHasher(TEST_HASH_PARAMS),
      new AccountRepository(tight.db),
      new SessionRepository(tight.db),
      new ThrottleRepository(tight.db),
      new AuditService(tight.db, tight.clock.fn),
      tight.clock.fn,
      createLogger({ level: 'info', service: 'api', destination: captureLogs().stream }),
      tight.verifier,
      tight.links,
    );
    for (const ip of ['10.1.0.1', '10.1.0.2']) {
      await failure(tightService.loginExternal({ login: 'zzz', password: 'bad-bad-bad' }, { ...META, ip }));
    }
    const calls = tight.verifier.calls.length;
    const globalBlock = await failure(tightService.loginExternal({ login: 'ANA', password: EXT_PASSWORD }, { ...META, ip: '10.1.0.3' }));
    expect(globalBlock.code).toBe('rate_limited');
    expect(tight.verifier.calls).toHaveLength(calls);
  });

  it.each([
    ['the seller account has no seller link at all', { email: 'nobody@example.test', login: 'NOBODY', role: 'seller', directorySeller: null }, 'no_link'],
    ['the directory reports a seller but the account has no link', { email: 'nolink@example.test', login: 'NOLINK', role: 'seller', directorySeller: 103 }, 'no_link'],
    ['the directory seller code differs from the Force link', { email: 'mis@example.test', login: 'MIS', role: 'seller', sellerCode: 103, directorySeller: 999 }, 'mismatch'],
    ['the directory seller code is invalid (0) for a linked seller', { email: 'inv@example.test', login: 'INV', role: 'seller', sellerCode: 103, directorySeller: 0 }, 'mismatch'],
    ['a manager has no link but the directory reports a seller', { email: 'mgr@example.test', login: 'MGR', role: 'manager', directorySeller: 55 }, 'no_link'],
  ] as const)('fails closed (uniform 401 invalid_credentials, no session, audited with the reason) when %s', async (_label, opts, reason) => {
    const ctx = await setup();
    const acc = await provision(ctx, opts);
    const err = await failure(ctx.service.loginExternal({ login: opts.login, password: EXT_PASSWORD }, META));
    expect(err.code).toBe('invalid_credentials');
    expect(err.status).toBe(401);
    expect(await ctx.db.select().from(session)).toHaveLength(0);
    const [row] = await audit(ctx, 'auth.login.link_mismatch');
    expect(row?.actorAccountId).toBe(acc.id);
    expect(row?.detail).toMatchObject({ reason });
    // No PII and no seller codes in the audit row, the error or the logs.
    const dump = JSON.stringify({ row, message: err.message, details: err.details, logs: ctx.capture.lines() });
    for (const needle of [opts.email, 'Directory Name', '999']) expect(dump).not.toContain(needle);
    expect(await audit(ctx, 'auth.login.success')).toHaveLength(0);
  });

  it('counts a link mismatch like a failed login (same error as a wrong password, then the login locks)', async () => {
    const ctx = await setup({ maxFailures: 2 });
    await provision(ctx, { email: 'mis@example.test', login: 'MIS', role: 'seller', sellerCode: 103, directorySeller: 999 });
    const wrong = await failure(ctx.service.loginExternal({ login: 'MIS', password: 'bad-bad-bad' }, META));
    const mismatch = await failure(ctx.service.loginExternal({ login: 'MIS', password: EXT_PASSWORD }, META));
    expect({ code: mismatch.code, status: mismatch.status, message: mismatch.message }).toEqual({
      code: wrong.code,
      status: wrong.status,
      message: wrong.message,
    });
    const keys = (await ctx.db.select().from(authThrottle)).map((row) => row.key);
    expect(keys.filter((key) => key.startsWith('extlogin:')).length).toBeGreaterThanOrEqual(1);
    // Two failures reached the per-login limit: the next attempt is refused before the directory.
    const calls = ctx.verifier.calls.length;
    expect((await failure(ctx.service.loginExternal({ login: 'MIS', password: EXT_PASSWORD }, META))).code).toBe('rate_limited');
    expect(ctx.verifier.calls).toHaveLength(calls);
  });

  it('pads a link mismatch to minFailureMs like any other credential failure', async () => {
    const ctx = await setup();
    const config = testAuthConfig({ externalLogin: { enabled: true, verifyTimeoutMs: 200, minFailureMs: 150 } });
    const service = new AuthService(
      config,
      new Argon2idPasswordHasher(config.passwordHash),
      new AccountRepository(ctx.db),
      new SessionRepository(ctx.db),
      new ThrottleRepository(ctx.db),
      new AuditService(ctx.db, ctx.clock.fn),
      ctx.clock.fn,
      createLogger({ level: 'info', service: 'api', destination: captureLogs().stream }),
      ctx.verifier,
      ctx.links,
    );
    await provision(ctx, { email: 'mis@example.test', login: 'MIS', role: 'seller', sellerCode: 103, directorySeller: 999 });
    const started = Date.now();
    expect((await failure(service.loginExternal({ login: 'MIS', password: EXT_PASSWORD }, META))).code).toBe('invalid_credentials');
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
  });

  it('admin and manager without a directory seller code log in without any seller link', async () => {
    const ctx = await setup();
    await provision(ctx, { email: 'mgr@example.test', login: 'MGR', role: 'manager', directorySeller: null });
    await provision(ctx, { email: 'adm@example.test', login: 'ADM', role: 'admin', directorySeller: 0 });
    for (const login of ['MGR', 'ADM']) {
      const { user } = await ctx.service.loginExternal({ login, password: EXT_PASSWORD }, META);
      expect(user.sellerCodes).toEqual([]);
    }
  });

  it('a seller whose link equals the directory code logs in with that scope only (never from the directory)', async () => {
    const ctx = await setup();
    await provision(ctx, { email: 'ok@example.test', login: 'OK', role: 'seller', sellerCode: 103, directorySeller: 103 });
    const { user } = await ctx.service.loginExternal({ login: 'OK', password: EXT_PASSWORD }, META);
    expect(user.sellerCodes).toEqual([103]);
    const identityStrategy = { ...DEMO_CONFIGURATION, customers: { ...DEMO_CONFIGURATION.customers, portfolioOwnership: { strategy: 'customer_seller_field' as const } } };
    const outcome = resolveCustomerScopeOutcome(toScopeActor(user), identityStrategy);
    expect(outcome).toEqual({ ok: true, scope: { kind: 'sellers', sellerCodes: [103] } });
  });

  it('never creates an account from an external identity', async () => {
    const ctx = await setup();
    ctx.verifier.users.set('NEW', { password: EXT_PASSWORD, identity: { externalUserId: 'ext-NEW', displayName: 'N', sellerCode: 5, active: true } });
    await failure(ctx.service.loginExternal({ login: 'NEW', password: EXT_PASSWORD }, META));
    expect(await ctx.db.select().from(account)).toHaveLength(0);
  });

  it('is refused (503, verifier untouched) when not enabled or not wired', async () => {
    for (const options of [{ enabled: false }, { wire: false }]) {
      const ctx = await setup(options);
      await provision(ctx, { email: 'ana@example.test', login: 'ANA' }).catch(() => undefined);
      const err = await failure(ctx.service.loginExternal({ login: 'ANA', password: EXT_PASSWORD }, META));
      expect(err.code).toBe('service_unavailable');
      expect(ctx.verifier.calls).toHaveLength(0);
      expect(await ctx.db.select().from(session)).toHaveLength(0);
    }
  });

  it('rejects empty or oversized input without calling the verifier', async () => {
    const ctx = await setup();
    for (const input of [
      { login: '', password: EXT_PASSWORD },
      { login: 'ANA', password: '' },
      { login: 'x'.repeat(300), password: EXT_PASSWORD },
    ]) {
      expect((await failure(ctx.service.loginExternal(input, META))).code).toBe('validation_failed');
    }
    expect(ctx.verifier.calls).toHaveLength(0);
  });

  it('keeps the password out of logs, audit rows, throttle keys, sessions and error text', async () => {
    const ctx = await setup({ maxFailures: 2 });
    const secret = 'Zq9-Unique-Password-Marker-7731';
    await provision(ctx, { email: 'ana@example.test', login: 'ANA', sellerCode: 103 });
    const errors: AppError[] = [];
    for (const mode of [null, 'unavailable', 'throw'] as const) {
      ctx.verifier.forced = mode === null ? null : mode === 'unavailable' ? { fail: 'unavailable' } : 'throw';
      errors.push(await failure(ctx.service.loginExternal({ login: 'ANA', password: secret }, META)));
    }
    ctx.verifier.forced = null;
    await ctx.service.loginExternal({ login: 'ANA', password: EXT_PASSWORD }, META).catch(() => undefined);
    // Also the case where a caller logs the credentials object itself: redaction by key and the secret wrapper.
    const logger = createLogger({ level: 'info', service: 'api', destination: ctx.capture.stream });
    logger.info({ credentials: { login: 'ANA', password: secret }, body: { password: secret } }, 'probe');

    const dump = JSON.stringify({
      logs: ctx.capture.lines(),
      audit: await ctx.db.select().from(auditLog),
      throttle: await ctx.db.select().from(authThrottle),
      sessions: await ctx.db.select().from(session),
      errors: errors.map((e) => ({ m: e.message, d: e.details, c: String(e.cause) })),
    });
    for (const value of [secret, EXT_PASSWORD]) expect(dump).not.toContain(value);
    // The login text is stored only hashed (key) / fingerprinted (audit).
    expect(JSON.stringify(await ctx.db.select().from(authThrottle))).not.toContain('ANA');
  });
});
