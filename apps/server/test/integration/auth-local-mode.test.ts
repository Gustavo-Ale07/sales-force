import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiErrorSchema, SESSION_COOKIE_NAME, SessionResponseSchema, routes } from '@salesforce/contracts';
import { auditLog, authThrottle, session } from '@salesforce/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ACCOUNT_THROTTLE, LOCAL_MODE_ROLES } from '../../src/iam/auth-config.js';
import { AuthService } from '../../src/iam/auth.service.js';
import { readCookie } from '../../src/iam/cookies.js';
import { TEST_ORIGIN, TEST_PASSWORD, WRONG_PASSWORD, createTestAccount, setCookieHeaders } from '../helpers/auth.js';
import { login, loginCookie, startAuthApp, type AuthApp } from '../helpers/auth-app.js';
import { startPostgres, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

/** `AUTH_MODE=local`: Force-local Argon2id login for the admin and technical profiles only (AUTH-5, ROLE-1; production-capable). */
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];

beforeAll(async () => {
  postgres = await startPostgres();
});

afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const boot = () => startAuthApp(postgres, opened, { authOverrides: { authMode: 'local', allowedRoles: LOCAL_MODE_ROLES } });

async function failureReasons(ctx: AuthApp): Promise<string[]> {
  const rows = await ctx.database.handle.db.select().from(auditLog);
  return rows.filter((row) => row.action === 'auth.login.failure').map((row) => (row.detail as { reason: string }).reason).sort();
}

/** Makes `audit_log` inserts of the given actions fail, as a broken audit store would. */
async function breakAudit(ctx: AuthApp, actions: readonly string[]): Promise<() => Promise<void>> {
  const list = actions.map((action) => `'${action}'`).join(', ');
  const { pool } = ctx.database.handle;
  await pool.query(`create function test_audit_broken() returns trigger language plpgsql as $$
    begin
      if new.action in (${list}) then raise exception 'audit store down'; end if;
      return new;
    end $$`);
  await pool.query('create trigger test_audit_broken_trg before insert on audit_log for each row execute function test_audit_broken()');
  return async () => {
    await pool.query('drop trigger test_audit_broken_trg on audit_log');
    await pool.query('drop function test_audit_broken()');
  };
}

describe('AUTH_MODE=local', () => {
  it('lets an admin in and reports authMode local', async () => {
    const ctx = await boot();
    await createTestAccount(ctx.database.handle, { username: 'admin@example.test', role: 'admin' }, ctx.clock.fn);
    const response = await login(ctx, 'admin@example.test', TEST_PASSWORD);
    expect(response.statusCode).toBe(200);
    expect(SessionResponseSchema.parse(response.json())).toMatchObject({ authenticated: true, authMode: 'local', account: { role: 'admin' } });
  });

  it('lets a technical profile in: role technical, no seller link', async () => {
    const ctx = await boot();
    await createTestAccount(ctx.database.handle, { username: 'tech@example.test', role: 'technical' }, ctx.clock.fn);
    const response = await login(ctx, 'tech@example.test', TEST_PASSWORD);
    expect(response.statusCode).toBe(200);
    expect(setCookieHeaders(response).length).toBeGreaterThan(0);
    expect(SessionResponseSchema.parse(response.json())).toMatchObject({
      authenticated: true,
      authMode: 'local',
      account: { role: 'technical', sellerCodes: [] },
    });
  });

  it('allows exactly admin and technical to hold a session under local mode', () => {
    expect([...LOCAL_MODE_ROLES].sort()).toEqual(['admin', 'technical']);
  });

  it('refuses seller and manager with the correct password, identically to a wrong password or an unknown e-mail', async () => {
    const ctx = await boot();
    await createTestAccount(ctx.database.handle, { username: 'seller@example.test', role: 'seller' }, ctx.clock.fn);
    await createTestAccount(ctx.database.handle, { username: 'manager@example.test', role: 'manager' }, ctx.clock.fn);
    await createTestAccount(ctx.database.handle, { username: 'admin@example.test', role: 'admin' }, ctx.clock.fn);

    const attempts = [
      await login(ctx, 'seller@example.test', TEST_PASSWORD, { remoteAddress: '10.9.0.1' }),
      await login(ctx, 'manager@example.test', TEST_PASSWORD, { remoteAddress: '10.9.0.2' }),
      await login(ctx, 'ghost@example.test', TEST_PASSWORD, { remoteAddress: '10.9.0.3' }),
      await login(ctx, 'admin@example.test', WRONG_PASSWORD, { remoteAddress: '10.9.0.4' }),
    ];
    for (const attempt of attempts) {
      expect(attempt.statusCode).toBe(401);
      expect(setCookieHeaders(attempt)).toEqual([]);
    }
    const bodies = attempts.map((attempt) => {
      const error = ApiErrorSchema.parse(attempt.json());
      return JSON.stringify({ code: error.code, message: error.message });
    });
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0] ?? '{}')).toMatchObject({ code: 'invalid_credentials' });
    expect(await failureReasons(ctx)).toEqual(['bad_password', 'mode_role_not_permitted', 'mode_role_not_permitted', 'unknown_account']);
  });

  it('applies the account lockout to a refused operational account like any other failure', async () => {
    const ctx = await boot();
    await createTestAccount(ctx.database.handle, { username: 'seller@example.test', role: 'seller' }, ctx.clock.fn);
    for (let attempt = 1; attempt <= DEFAULT_ACCOUNT_THROTTLE.maxFailures; attempt += 1) {
      const response = await login(ctx, 'seller@example.test', TEST_PASSWORD, { remoteAddress: `10.9.1.${attempt}` });
      expect(response.statusCode).toBe(401);
    }
    const blocked = await login(ctx, 'seller@example.test', TEST_PASSWORD, { remoteAddress: '10.9.1.99' });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBe(String(DEFAULT_ACCOUNT_THROTTLE.baseLockMs / 1000));
  });

  it('applies the account lockout to an admin with a wrong password, then blocks the right one', async () => {
    const ctx = await boot();
    await createTestAccount(ctx.database.handle, { username: 'admin@example.test', role: 'admin' }, ctx.clock.fn);
    for (let attempt = 1; attempt <= DEFAULT_ACCOUNT_THROTTLE.maxFailures; attempt += 1) {
      await login(ctx, 'admin@example.test', WRONG_PASSWORD, { remoteAddress: `10.9.2.${attempt}` });
    }
    expect((await login(ctx, 'admin@example.test', TEST_PASSWORD, { remoteAddress: '10.9.2.99' })).statusCode).toBe(429);
  });

  it('does not resolve a session of an operational account that predates the mode', async () => {
    const dev = await startAuthApp(postgres, opened);
    await createTestAccount(dev.database.handle, { username: 'seller@example.test', role: 'seller' }, dev.clock.fn);
    const cookie = await loginCookie(dev, 'seller@example.test', TEST_PASSWORD);

    const local = await startAuthApp(postgres, opened, {
      database: dev.database,
      authOverrides: { authMode: 'local', allowedRoles: LOCAL_MODE_ROLES },
    });
    const response = await local.app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie } });
    expect(response.json()).toEqual({ authenticated: false, authMode: 'local' });
  });

  it('peekSession (used by /ready) rejects a session of an operational account that predates the mode', async () => {
    const dev = await startAuthApp(postgres, opened);
    await createTestAccount(dev.database.handle, { username: 'seller@example.test', role: 'seller' }, dev.clock.fn);
    await createTestAccount(dev.database.handle, { username: 'admin@example.test', role: 'admin' }, dev.clock.fn);
    const sellerToken = readCookie(await loginCookie(dev, 'seller@example.test', TEST_PASSWORD), SESSION_COOKIE_NAME);
    const adminToken = readCookie(await loginCookie(dev, 'admin@example.test', TEST_PASSWORD), SESSION_COOKIE_NAME);

    // Same database, mode switched to local.
    const local = await startAuthApp(postgres, opened, {
      database: dev.database,
      authOverrides: { authMode: 'local', allowedRoles: LOCAL_MODE_ROLES },
    });
    const service = local.app.get(AuthService);
    expect(await service.peekSession(sellerToken)).toBeNull();
    expect(await service.peekSession(adminToken)).toEqual({ role: 'admin' });
  });

  it('exposes no external login route: no controller references loginExternal and no registered route mentions external', async () => {
    const ctx = await boot();
    const routeTable = ctx.app.getHttpAdapter().getInstance().printRoutes({ commonPrefix: false });
    expect(routeTable.length).toBeGreaterThan(0);
    expect(routeTable.toLowerCase()).not.toContain('external');
    expect(routeTable).toContain('login');

    const srcRoot = fileURLToPath(new URL('../../src/', import.meta.url));
    const controllers = readdirSync(srcRoot, { recursive: true, encoding: 'utf8' }).filter((name) => /controller\.ts$/.test(name));
    expect(controllers.length).toBeGreaterThan(0);
    for (const name of controllers) {
      expect(readFileSync(join(srcRoot, name), 'utf8'), name).not.toMatch(/loginExternal|ExternalIdentityVerifier/);
    }
    // Contract registry has no external-login operation either.
    expect(Object.values(routes).map((route) => `${route.operationId} ${route.path}`.toLowerCase()).filter((text) => text.includes('external'))).toEqual([]);
  });

  describe('AUDIT-1: a successful privileged login needs its audit record (fail closed)', () => {
    it.each(['admin', 'technical'] as const)(
      'opens no session and no cookie for a %s when the success audit cannot be written, and works once it can',
      async (role) => {
        const ctx = await boot();
        await createTestAccount(ctx.database.handle, { username: `${role}@example.test`, role }, ctx.clock.fn);
        const restore = await breakAudit(ctx, ['auth.login.success']);

        const response = await login(ctx, `${role}@example.test`, TEST_PASSWORD);
        expect(response.statusCode).toBe(503);
        expect(ApiErrorSchema.parse(response.json()).code).toBe('service_unavailable');
        expect(setCookieHeaders(response)).toEqual([]);
        expect(await ctx.database.handle.db.select().from(session)).toHaveLength(0);
        // Not a credential failure: no failure audit, no throttle counter for the account or the address.
        expect(await failureReasons(ctx)).toEqual([]);
        expect((await ctx.database.handle.db.select().from(authThrottle)).filter((row) => row.failures > 0)).toEqual([]);
        // Internal log carries the error class only: no e-mail, address or driver text.
        const logs = JSON.stringify(ctx.capture.lines());
        expect(logs).toContain('mandatory login audit');
        for (const needle of [`${role}@example.test`, 'audit store down', TEST_PASSWORD]) expect(logs).not.toContain(needle);

        await restore();
        const ok = await login(ctx, `${role}@example.test`, TEST_PASSWORD);
        expect(ok.statusCode).toBe(200);
        expect(await ctx.database.handle.db.select().from(session)).toHaveLength(1);
        const successes = (await ctx.database.handle.db.select().from(auditLog)).filter((row) => row.action === 'auth.login.success');
        expect(successes).toHaveLength(1);
      },
    );

    it('writes the success audit row with the session id', async () => {
      const ctx = await boot();
      const tech = await createTestAccount(ctx.database.handle, { username: 'tech@example.test', role: 'technical' }, ctx.clock.fn);
      expect((await login(ctx, 'tech@example.test', TEST_PASSWORD)).statusCode).toBe(200);
      const [row] = (await ctx.database.handle.db.select().from(auditLog)).filter((r) => r.action === 'auth.login.success');
      const [stored] = await ctx.database.handle.db.select().from(session);
      expect(row?.actorAccountId).toBe(tech.id);
      expect((row?.detail as { sessionId: string }).sessionId).toBe(stored?.id);
    });

    it('does not affect logout, which stays available and audited', async () => {
      const ctx = await boot();
      await createTestAccount(ctx.database.handle, { username: 'tech@example.test', role: 'technical' }, ctx.clock.fn);
      const cookie = await loginCookie(ctx, 'tech@example.test', TEST_PASSWORD);
      const restore = await breakAudit(ctx, ['auth.login.success']);
      const out = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { cookie, origin: TEST_ORIGIN, 'content-type': 'application/json' },
        payload: '{}',
      });
      await restore();
      expect([200, 204]).toContain(out.statusCode);
      expect((await ctx.database.handle.db.select().from(auditLog)).filter((r) => r.action === 'auth.logout')).toHaveLength(1);
    });
  });

  describe('AUDIT-1: an invalid login is independent of audit persistence (best effort)', () => {
    it('answers the same 401 body, moves the throttle and locks out although every failure audit write throws', async () => {
      const healthy = await boot();
      await createTestAccount(healthy.database.handle, { username: 'admin@example.test', role: 'admin' }, healthy.clock.fn);
      const reference = await login(healthy, 'admin@example.test', WRONG_PASSWORD, { remoteAddress: '10.8.0.1' });

      const ctx = await boot();
      await createTestAccount(ctx.database.handle, { username: 'admin@example.test', role: 'admin' }, ctx.clock.fn);
      await createTestAccount(ctx.database.handle, { username: 'seller@example.test', role: 'seller' }, ctx.clock.fn);
      await breakAudit(ctx, ['auth.login.failure', 'auth.lockout', 'auth.login.blocked']);

      const wrong = await login(ctx, 'admin@example.test', WRONG_PASSWORD, { remoteAddress: '10.8.0.1' });
      const unknown = await login(ctx, 'ghost@example.test', TEST_PASSWORD, { remoteAddress: '10.8.0.2' });
      const refusedRole = await login(ctx, 'seller@example.test', TEST_PASSWORD, { remoteAddress: '10.8.0.3' });
      for (const attempt of [wrong, unknown, refusedRole]) {
        expect(attempt.statusCode).toBe(401);
        expect(setCookieHeaders(attempt)).toEqual([]);
        expect({ ...attempt.json(), details: undefined }).toEqual({ ...reference.json(), details: undefined });
      }
      expect(await ctx.database.handle.db.select().from(session)).toHaveLength(0);
      const throttled = (await ctx.database.handle.db.select().from(authThrottle)).filter((row) => row.failures > 0);
      expect(throttled.length).toBeGreaterThanOrEqual(3);

      // Lockout still works with the audit store down: 5 failures lock, the right password is then refused with 429.
      for (let attempt = 2; attempt <= DEFAULT_ACCOUNT_THROTTLE.maxFailures; attempt += 1) {
        await login(ctx, 'admin@example.test', WRONG_PASSWORD, { remoteAddress: `10.8.1.${attempt}` });
      }
      const locked = await login(ctx, 'admin@example.test', TEST_PASSWORD, { remoteAddress: '10.8.1.99' });
      expect(locked.statusCode).toBe(429);
      expect(locked.headers['retry-after']).toBe(String(DEFAULT_ACCOUNT_THROTTLE.baseLockMs / 1000));
    });
  });
});
