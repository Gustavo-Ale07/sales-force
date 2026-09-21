import { ApiErrorSchema, SESSION_COOKIE_NAME, SessionResponseSchema } from '@salesforce/contracts';
import { account, auditLog, authThrottle, session } from '@salesforce/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ACCOUNT_THROTTLE, DEFAULT_IP_THROTTLE } from '../../src/iam/auth-config.js';
import { hashSessionToken } from '../../src/iam/session-crypto.js';
import {
  TEST_ORIGIN,
  TEST_PASSWORD,
  WRONG_PASSWORD,
  createTestAccount,
  sessionCookieOf,
  setCookieHeaders,
  tokenOf,
} from '../helpers/auth.js';
import { login, loginCookie, startAuthApp, type AuthApp } from '../helpers/auth-app.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];

beforeAll(async () => {
  postgres = await startPostgres();
});

afterAll(async () => {
  for (const close of opened.reverse()) await close();
  await postgres.stop();
});

const boot = (options: Parameters<typeof startAuthApp>[2] = {}) => startAuthApp(postgres, opened, options);

async function auditRows(ctx: AuthApp, action?: string) {
  const rows = await ctx.database.handle.db.select().from(auditLog);
  return action === undefined ? rows : rows.filter((row) => row.action === action);
}

const setStatus = (ctx: AuthApp, id: string, status: 'active' | 'disabled') =>
  ctx.database.handle.db.update(account).set({ status }).where(eq(account.id, id));

const get = (ctx: AuthApp, url: string, cookie?: string, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: 'GET', url, headers: { ...(cookie === undefined ? {} : { cookie }), ...headers } });

const logout = (ctx: AuthApp, cookie?: string, headers: Record<string, string> = {}) =>
  ctx.app.inject({
    method: 'POST',
    url: '/api/v1/auth/logout',
    headers: { origin: TEST_ORIGIN, ...(cookie === undefined ? {} : { cookie }), ...headers },
  });

describe('login', () => {
  it('opens a session: cookie flags, no token in the body, no-store, audit row', async () => {
    const ctx = await boot();
    const admin = await createTestAccount(ctx.database.handle, { email: 'Admin@Example.test', role: 'admin' }, ctx.clock.fn);

    const response = await login(ctx, 'ADMIN@example.test', TEST_PASSWORD);
    expect(response.statusCode).toBe(200);

    const body = SessionResponseSchema.parse(response.json());
    expect(body).toMatchObject({ authenticated: true, authMode: 'dev', account: { id: admin.id, role: 'admin', sellerCodes: [] } });

    const cookie = setCookieHeaders(response).find((entry) => entry.startsWith(`${SESSION_COOKIE_NAME}=`)) ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Path=/api/v1');
    expect(cookie).toContain(`Max-Age=${ctx.auth.sessionIdleMs / 1000}`);

    const token = tokenOf(sessionCookieOf(response));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.body).not.toContain(token);
    expect(JSON.stringify(response.headers)).not.toContain(TEST_PASSWORD);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');

    // Only the hash is stored.
    const [row] = await ctx.database.handle.db.select().from(session);
    expect(row?.tokenHash).toBe(hashSessionToken(token));
    expect(JSON.stringify(row)).not.toContain(token);

    const [success] = await auditRows(ctx, 'auth.login.success');
    expect(success?.actorAccountId).toBe(admin.id);
  });

  it('refuses a body that does not match the contract, without echoing it', async () => {
    const ctx = await boot();
    const response = await login(ctx, 'not-an-email', 'x');
    expect(response.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(response.json()).code).toBe('validation_failed');
    expect(response.body).not.toContain('not-an-email');
  });

  it('gives an identical answer for an unknown e-mail, a wrong password, a disabled account and an unreachable role', async () => {
    const ctx = await boot();
    await createTestAccount(ctx.database.handle, { email: 'known@example.test', role: 'seller' }, ctx.clock.fn);
    const disabled = await createTestAccount(ctx.database.handle, { email: 'off@example.test', role: 'seller' }, ctx.clock.fn);
    await setStatus(ctx, disabled.id, 'disabled');

    const attempts = await Promise.all([
      login(ctx, 'ghost@example.test', TEST_PASSWORD, { remoteAddress: '10.0.0.1' }),
      login(ctx, 'known@example.test', WRONG_PASSWORD, { remoteAddress: '10.0.0.2' }),
      login(ctx, 'off@example.test', TEST_PASSWORD, { remoteAddress: '10.0.0.3' }),
    ]);
    for (const attempt of attempts) {
      expect(attempt.statusCode).toBe(401);
      expect(setCookieHeaders(attempt)).toEqual([]);
    }
    const bodies = attempts.map((attempt) => {
      const error = ApiErrorSchema.parse(attempt.json());
      return { code: error.code, message: error.message };
    });
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    expect(bodies[0]?.code).toBe('invalid_credentials');

    // The reason is recorded internally, never shown.
    const reasons = (await auditRows(ctx, 'auth.login.failure')).map((row) => (row.detail as { reason: string }).reason).sort();
    expect(reasons).toEqual(['account_disabled', 'bad_password', 'unknown_account']);
  });

  it('never records the attempted e-mail of an unknown account or any password in audit rows or logs', async () => {
    const ctx = await boot();
    await createTestAccount(ctx.database.handle, { email: 'real@example.test', role: 'admin' }, ctx.clock.fn);
    await login(ctx, 'attacker-chosen@example.test', WRONG_PASSWORD);
    await login(ctx, 'real@example.test', WRONG_PASSWORD);
    const ok = await login(ctx, 'real@example.test', TEST_PASSWORD);
    const token = tokenOf(sessionCookieOf(ok));

    const everything = JSON.stringify(await auditRows(ctx)) + JSON.stringify(ctx.capture.lines());
    for (const secret of [TEST_PASSWORD, WRONG_PASSWORD, token, 'attacker-chosen@example.test']) {
      expect(everything, secret).not.toContain(secret);
    }
    const unknown = (await auditRows(ctx, 'auth.login.failure')).find((row) => row.actorAccountId === null);
    expect((unknown?.detail as { emailFingerprint?: string }).emailFingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it('answers with the same 401 whether or not the e-mail is registered (and never leaks it in cookies)', async () => {
    const ctx = await boot();
    await createTestAccount(ctx.database.handle, { email: 'known@example.test', role: 'seller' }, ctx.clock.fn);
    const [a, b] = await Promise.all([
      login(ctx, 'known@example.test', WRONG_PASSWORD),
      login(ctx, 'unknown@example.test', WRONG_PASSWORD),
    ]);
    expect(a.statusCode).toBe(b.statusCode);
    expect(Object.keys(a.headers).sort()).toEqual(Object.keys(b.headers).sort());
  });
});

describe('lockout and rate limit (RF-IAM-2)', () => {
  it('locks an account after five failures and blocks even the right password, with Retry-After', async () => {
    const ctx = await boot();
    await createTestAccount(ctx.database.handle, { email: 'lock@example.test', role: 'seller' }, ctx.clock.fn);

    for (let attempt = 1; attempt <= DEFAULT_ACCOUNT_THROTTLE.maxFailures; attempt += 1) {
      const response = await login(ctx, 'lock@example.test', WRONG_PASSWORD, { remoteAddress: `10.1.0.${attempt}` });
      expect(response.statusCode).toBe(401);
    }

    const blocked = await login(ctx, 'lock@example.test', TEST_PASSWORD, { remoteAddress: '10.1.0.99' });
    expect(blocked.statusCode).toBe(429);
    expect(ApiErrorSchema.parse(blocked.json()).code).toBe('rate_limited');
    expect(blocked.headers['retry-after']).toBe(String((DEFAULT_ACCOUNT_THROTTLE.baseLockMs) / 1000));
    expect(setCookieHeaders(blocked)).toEqual([]);

    expect(await auditRows(ctx, 'auth.lockout')).toHaveLength(1);
    expect(await auditRows(ctx, 'auth.login.blocked')).toHaveLength(1);
  });

  it('applies the same lockout to an unregistered e-mail (no enumeration by lockout)', async () => {
    const ctx = await boot();
    for (let attempt = 1; attempt <= DEFAULT_ACCOUNT_THROTTLE.maxFailures; attempt += 1) {
      await login(ctx, 'ghost@example.test', WRONG_PASSWORD, { remoteAddress: `10.2.0.${attempt}` });
    }
    const blocked = await login(ctx, 'ghost@example.test', WRONG_PASSWORD, { remoteAddress: '10.2.0.99' });
    expect(blocked.statusCode).toBe(429);
    // Counters store a hash of the e-mail, never the address.
    const keys = (await ctx.database.handle.db.select().from(authThrottle)).map((row) => row.key);
    expect(keys.some((key) => key.includes('ghost'))).toBe(false);
  });

  it('lets the account in again when the lock ends, and doubles the next lock', async () => {
    const ctx = await boot();
    await createTestAccount(ctx.database.handle, { email: 'lock@example.test', role: 'seller' }, ctx.clock.fn);
    const fail = async (n: number, from: string) => {
      for (let i = 0; i < n; i += 1) await login(ctx, 'lock@example.test', WRONG_PASSWORD, { remoteAddress: `${from}.${i}` });
    };

    await fail(5, '10.3.0');
    ctx.clock.advance(DEFAULT_ACCOUNT_THROTTLE.baseLockMs - 1_000);
    expect((await login(ctx, 'lock@example.test', TEST_PASSWORD, { remoteAddress: '10.3.1.1' })).statusCode).toBe(429);

    ctx.clock.advance(2_000);
    await fail(5, '10.3.2');
    const second = await login(ctx, 'lock@example.test', TEST_PASSWORD, { remoteAddress: '10.3.3.1' });
    expect(second.statusCode).toBe(429);
    expect(second.headers['retry-after']).toBe(String((DEFAULT_ACCOUNT_THROTTLE.baseLockMs * 2) / 1000));

    ctx.clock.advance(DEFAULT_ACCOUNT_THROTTLE.baseLockMs * 2 + 1_000);
    expect((await login(ctx, 'lock@example.test', TEST_PASSWORD, { remoteAddress: '10.3.4.1' })).statusCode).toBe(200);
  });

  it('a success clears the failure counter of the account', async () => {
    const ctx = await boot();
    await createTestAccount(ctx.database.handle, { email: 'reset@example.test', role: 'seller' }, ctx.clock.fn);
    for (let i = 0; i < DEFAULT_ACCOUNT_THROTTLE.maxFailures - 1; i += 1) {
      await login(ctx, 'reset@example.test', WRONG_PASSWORD, { remoteAddress: `10.4.0.${i}` });
    }
    expect((await login(ctx, 'reset@example.test', TEST_PASSWORD, { remoteAddress: '10.4.1.1' })).statusCode).toBe(200);
    // Four more failures do not lock: the counter started again from zero.
    for (let i = 0; i < DEFAULT_ACCOUNT_THROTTLE.maxFailures - 1; i += 1) {
      await login(ctx, 'reset@example.test', WRONG_PASSWORD, { remoteAddress: `10.4.2.${i}` });
    }
    expect((await login(ctx, 'reset@example.test', TEST_PASSWORD, { remoteAddress: '10.4.3.1' })).statusCode).toBe(200);
  });

  it('rate-limits one client address across different e-mails', async () => {
    const ctx = await boot({
      authOverrides: {
        throttle: { account: DEFAULT_ACCOUNT_THROTTLE, ip: { ...DEFAULT_IP_THROTTLE, maxFailures: 4 } },
      },
    });
    for (let i = 0; i < 4; i += 1) {
      const response = await login(ctx, `spray${i}@example.test`, WRONG_PASSWORD, { remoteAddress: '203.0.113.9' });
      expect(response.statusCode).toBe(401);
    }
    const blocked = await login(ctx, 'another@example.test', WRONG_PASSWORD, { remoteAddress: '203.0.113.9' });
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    // Another address is unaffected.
    expect((await login(ctx, 'another@example.test', WRONG_PASSWORD, { remoteAddress: '203.0.113.10' })).statusCode).toBe(401);
  });

  it('ignores X-Forwarded-For unless the proxy is trusted', async () => {
    const ctx = await boot({
      authOverrides: {
        throttle: { account: DEFAULT_ACCOUNT_THROTTLE, ip: { ...DEFAULT_IP_THROTTLE, maxFailures: 3 } },
      },
    });
    // The client rotates a forged header; the socket address is what counts.
    for (let i = 0; i < 3; i += 1) {
      await login(ctx, `u${i}@example.test`, WRONG_PASSWORD, { remoteAddress: '198.51.100.7', headers: { 'x-forwarded-for': `1.1.1.${i}` } });
    }
    const blocked = await login(ctx, 'u9@example.test', WRONG_PASSWORD, {
      remoteAddress: '198.51.100.7',
      headers: { 'x-forwarded-for': '9.9.9.9' },
    });
    expect(blocked.statusCode).toBe(429);
  });

  it('honours X-Forwarded-For from a trusted proxy hop only', async () => {
    const ctx = await boot({
      trustProxy: 1,
      authOverrides: {
        throttle: { account: DEFAULT_ACCOUNT_THROTTLE, ip: { ...DEFAULT_IP_THROTTLE, maxFailures: 2 } },
      },
    });
    const viaProxy = (client: string, email: string) =>
      login(ctx, email, WRONG_PASSWORD, { remoteAddress: '10.9.9.9', headers: { 'x-forwarded-for': client } });
    await viaProxy('192.0.2.1', 'a@example.test');
    await viaProxy('192.0.2.1', 'b@example.test');
    expect((await viaProxy('192.0.2.1', 'c@example.test')).statusCode).toBe(429);
    expect((await viaProxy('192.0.2.2', 'c@example.test')).statusCode).toBe(401);
  });
});

describe('sessions', () => {
  it('reports the session, then ends it on logout and rejects the old cookie', async () => {
    const ctx = await boot();
    await createTestAccount(ctx.database.handle, { email: 'user@example.test', role: 'manager' }, ctx.clock.fn);
    const cookie = await loginCookie(ctx, 'user@example.test', TEST_PASSWORD);

    const current = await get(ctx, '/api/v1/auth/session', cookie);
    expect(SessionResponseSchema.parse(current.json())).toMatchObject({ authenticated: true, account: { role: 'manager' } });

    const out = await logout(ctx, cookie);
    expect(out.statusCode).toBe(204);
    const cleared = setCookieHeaders(out).find((entry) => entry.startsWith(`${SESSION_COOKIE_NAME}=`)) ?? '';
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).toContain('HttpOnly');

    const after = await get(ctx, '/api/v1/auth/session', cookie);
    expect(after.json()).toEqual({ authenticated: false, authMode: 'dev' });
    expect((await logout(ctx, cookie)).statusCode).toBe(401);

    const [row] = await ctx.database.handle.db.select().from(session);
    expect(row?.revokedAt).not.toBeNull();
    expect(await auditRows(ctx, 'auth.logout')).toHaveLength(1);
  });

  it('answers an anonymous probe with authenticated:false and no cookie', async () => {
    const ctx = await boot();
    const response = await get(ctx, '/api/v1/auth/session');
    expect(response.statusCode).toBe(200);
    expect(SessionResponseSchema.parse(response.json())).toEqual({ authenticated: false, authMode: 'dev' });
    expect(setCookieHeaders(response)).toEqual([]);
  });

  it('clears a cookie that no longer maps to a session', async () => {
    const ctx = await boot();
    const stale = `${SESSION_COOKIE_NAME}=${'a'.repeat(43)}`;
    const response = await get(ctx, '/api/v1/auth/session', stale);
    expect(response.json()).toMatchObject({ authenticated: false });
    expect(setCookieHeaders(response).join('')).toContain('Max-Age=0');

    const guarded = await logout(ctx, stale);
    expect(guarded.statusCode).toBe(401);
    expect(setCookieHeaders(guarded).join('')).toContain('Max-Age=0');
    expect(ApiErrorSchema.parse(guarded.json()).code).toBe('unauthenticated');
  });

  it('rejects malformed tokens before touching the database', async () => {
    const ctx = await boot();
    for (const value of ['', 'short', 'a'.repeat(44), `${'a'.repeat(42)}!`]) {
      const response = await logout(ctx, `${SESSION_COOKIE_NAME}=${value}`);
      expect(response.statusCode, value).toBe(401);
    }
  });

  it('expires after the idle timeout and slides while the user is active', async () => {
    const ctx = await boot();
    await createTestAccount(ctx.database.handle, { email: 'idle@example.test', role: 'seller' }, ctx.clock.fn);
    const cookie = await loginCookie(ctx, 'idle@example.test', TEST_PASSWORD);

    // Activity every 20 minutes keeps a 30-minute idle session alive past the 30-minute mark.
    ctx.clock.advance(20 * 60_000);
    const slid = await get(ctx, '/api/v1/auth/session', cookie);
    expect(slid.json()).toMatchObject({ authenticated: true });
    expect(setCookieHeaders(slid).join('')).toContain(`${SESSION_COOKIE_NAME}=`); // cookie lifetime renewed

    ctx.clock.advance(20 * 60_000);
    expect((await get(ctx, '/api/v1/auth/session', cookie)).json()).toMatchObject({ authenticated: true });

    ctx.clock.advance(31 * 60_000);
    expect((await get(ctx, '/api/v1/auth/session', cookie)).json()).toMatchObject({ authenticated: false });
  });

  it('never outlives the absolute lifetime, however active the user is', async () => {
    const ctx = await boot();
    await createTestAccount(ctx.database.handle, { email: 'abs@example.test', role: 'seller' }, ctx.clock.fn);
    const cookie = await loginCookie(ctx, 'abs@example.test', TEST_PASSWORD);

    let elapsed = 0;
    while (elapsed + 20 * 60_000 < ctx.auth.sessionAbsoluteMs) {
      ctx.clock.advance(20 * 60_000);
      elapsed += 20 * 60_000;
      expect((await get(ctx, '/api/v1/auth/session', cookie)).json()).toMatchObject({ authenticated: true });
    }
    ctx.clock.advance(ctx.auth.sessionAbsoluteMs - elapsed + 1_000);
    expect((await get(ctx, '/api/v1/auth/session', cookie)).json()).toMatchObject({ authenticated: false });
  });

  it('ends a session when the account is disabled, and when the row is revoked', async () => {
    const ctx = await boot();
    const user = await createTestAccount(ctx.database.handle, { email: 'gone@example.test', role: 'seller' }, ctx.clock.fn);
    const cookie = await loginCookie(ctx, 'gone@example.test', TEST_PASSWORD);
    await setStatus(ctx, user.id, 'disabled');
    expect((await get(ctx, '/api/v1/auth/session', cookie)).json()).toMatchObject({ authenticated: false });

    await setStatus(ctx, user.id, 'active');
    const fresh = await loginCookie(ctx, 'gone@example.test', TEST_PASSWORD);
    await ctx.database.handle.db.update(session).set({ revokedAt: ctx.clock.fn() }).where(eq(session.accountId, user.id));
    expect((await get(ctx, '/api/v1/auth/session', fresh)).json()).toMatchObject({ authenticated: false });
  });
});

describe('CSRF', () => {
  it('refuses state-changing requests from other origins, on login and on a session route', async () => {
    const ctx = await boot();
    await createTestAccount(ctx.database.handle, { email: 'csrf@example.test', role: 'admin' }, ctx.clock.fn);
    const cookie = await loginCookie(ctx, 'csrf@example.test', TEST_PASSWORD);

    const evilLogin = await login(ctx, 'csrf@example.test', TEST_PASSWORD, { headers: { origin: 'https://evil.example.com' } });
    expect(evilLogin.statusCode).toBe(403);
    expect(setCookieHeaders(evilLogin)).toEqual([]);

    const evilLogout = await logout(ctx, cookie, { origin: 'https://evil.example.com' });
    expect(evilLogout.statusCode).toBe(403);
    // No Origin header (some browsers omit it): Fetch Metadata decides.
    const crossSite = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie, 'sec-fetch-site': 'cross-site' },
    });
    expect(crossSite.statusCode).toBe(403);
    // The session survived the forged requests.
    expect((await get(ctx, '/api/v1/auth/session', cookie)).json()).toMatchObject({ authenticated: true });
  });

  it('accepts same-origin browser requests and header-less non-browser clients', async () => {
    const ctx = await boot();
    await createTestAccount(ctx.database.handle, { email: 'csrf@example.test', role: 'admin' }, ctx.clock.fn);
    const ok = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      payload: JSON.stringify({ email: 'csrf@example.test', password: TEST_PASSWORD }),
    });
    expect(ok.statusCode).toBe(200);
    const bare = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'csrf@example.test', password: TEST_PASSWORD }),
    });
    expect(bare.statusCode).toBe(200);
  });

  it('never lets a GET change state (logout is POST only)', async () => {
    const ctx = await boot();
    const response = await get(ctx, '/api/v1/auth/logout');
    expect(response.statusCode).toBe(404);
  });
});

describe('default deny', () => {
  it('refuses a handler that is not bound to the contract registry, for anyone', async () => {
    const ctx = await boot({ withProbes: true });
    await createTestAccount(ctx.database.handle, { email: 'root@example.test', role: 'admin' }, ctx.clock.fn);
    const cookie = await loginCookie(ctx, 'root@example.test', TEST_PASSWORD);

    for (const headers of [{}, { cookie }]) {
      const read = await ctx.app.inject({ method: 'GET', url: '/api/v1/probe-unbound', headers });
      expect(read.statusCode).toBe(403);
      const write = await ctx.app.inject({ method: 'POST', url: '/api/v1/probe-unbound', headers: { origin: TEST_ORIGIN, ...headers } });
      expect(write.statusCode).toBe(403);
      expect(read.body).not.toContain('reached');
    }
  });

  it('refuses a session route that has no grant in the policy table, even for an admin, and 401 without a session', async () => {
    const ctx = await boot({ withProbes: true });
    await createTestAccount(ctx.database.handle, { email: 'root@example.test', role: 'admin' }, ctx.clock.fn);
    const cookie = await loginCookie(ctx, 'root@example.test', TEST_PASSWORD);

    const anonymous = await get(ctx, '/api/v1/sellers');
    expect(anonymous.statusCode).toBe(401);
    const admin = await get(ctx, '/api/v1/sellers', cookie);
    expect(admin.statusCode).toBe(403);
    expect(ApiErrorSchema.parse(admin.json()).code).toBe('forbidden');
  });

  it('blocks a role the policy does not know (the external representative does not exist yet) on every request', async () => {
    const ctx = await boot();
    const rep = await createTestAccount(ctx.database.handle, { email: 'rep@example.test', role: 'seller' }, ctx.clock.fn);
    const cookie = await loginCookie(ctx, 'rep@example.test', TEST_PASSWORD);
    // The role column has a CHECK; a role added by a later migration is simulated by dropping it here.
    await ctx.database.handle.db.execute(sql.raw('alter table account drop constraint account_role_chk'));
    await ctx.database.handle.db.update(account).set({ role: 'external_representative' }).where(eq(account.id, rep.id));

    const denied = await logout(ctx, cookie);
    expect(denied.statusCode).toBe(403);
    const configuration = await get(ctx, '/api/v1/configuration', cookie);
    expect(configuration.statusCode).toBe(403);
    const probe = await get(ctx, '/api/v1/auth/session', cookie);
    expect(probe.json()).toEqual({ authenticated: false, authMode: 'dev' });

    // And cannot open a new web session either: same answer as a wrong password.
    const again = await login(ctx, 'rep@example.test', TEST_PASSWORD);
    expect(again.statusCode).toBe(401);
    expect(ApiErrorSchema.parse(again.json()).code).toBe('invalid_credentials');
    const [reason] = (await auditRows(ctx, 'auth.login.failure')).map((row) => (row.detail as { reason: string }).reason);
    expect(reason).toBe('channel_not_permitted');
  });
});

describe('GET /configuration', () => {
  it('is admin only, 401 without a session, and reports the unconfigured installation', async () => {
    const ctx = await boot();
    await createTestAccount(ctx.database.handle, { email: 'admin@example.test', role: 'admin' }, ctx.clock.fn);
    await createTestAccount(ctx.database.handle, { email: 'mgr@example.test', role: 'manager' }, ctx.clock.fn);
    await createTestAccount(ctx.database.handle, { email: 'sel@example.test', role: 'seller' }, ctx.clock.fn);
    const [admin, manager, seller] = await Promise.all([
      loginCookie(ctx, 'admin@example.test', TEST_PASSWORD),
      loginCookie(ctx, 'mgr@example.test', TEST_PASSWORD),
      loginCookie(ctx, 'sel@example.test', TEST_PASSWORD),
    ]);

    expect((await get(ctx, '/api/v1/configuration')).statusCode).toBe(401);
    expect((await get(ctx, '/api/v1/configuration', manager)).statusCode).toBe(403);
    expect((await get(ctx, '/api/v1/configuration', seller)).statusCode).toBe(403);

    const response = await get(ctx, '/api/v1/configuration', admin);
    expect(response.statusCode).toBe(200);
    const body = response.json() as { contentHash: unknown; configuration: { general: { enabled: boolean } }; gateway: { mode: string } };
    expect(body.contentHash).toBeNull();
    expect(body.configuration.general.enabled).toBe(false);
    expect(response.headers['cache-control']).toBe('no-store');
    // The synchronization cursor and account e-mails are never part of the body.
    expect(response.body).not.toMatch(/cursor|@example\.test/i);
  });
});
