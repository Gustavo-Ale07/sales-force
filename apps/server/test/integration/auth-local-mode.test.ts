import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiErrorSchema, SESSION_COOKIE_NAME, SessionResponseSchema, routes } from '@salesforce/contracts';
import { auditLog } from '@salesforce/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ACCOUNT_THROTTLE, LOCAL_MODE_ROLES } from '../../src/iam/auth-config.js';
import { AuthService } from '../../src/iam/auth.service.js';
import { readCookie } from '../../src/iam/cookies.js';
import { TEST_PASSWORD, WRONG_PASSWORD, createTestAccount, setCookieHeaders } from '../helpers/auth.js';
import { login, loginCookie, startAuthApp, type AuthApp } from '../helpers/auth-app.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

/** `AUTH_MODE=local`: Force-local Argon2id login for the admin profile only (production-capable). */
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];

beforeAll(async () => {
  postgres = await startPostgres();
});

afterAll(async () => {
  for (const close of opened.reverse()) await close();
  await postgres.stop();
});

const boot = () => startAuthApp(postgres, opened, { authOverrides: { authMode: 'local', allowedRoles: LOCAL_MODE_ROLES } });

async function failureReasons(ctx: AuthApp): Promise<string[]> {
  const rows = await ctx.database.handle.db.select().from(auditLog);
  return rows.filter((row) => row.action === 'auth.login.failure').map((row) => (row.detail as { reason: string }).reason).sort();
}

describe('AUTH_MODE=local', () => {
  it('lets an admin in and reports authMode local', async () => {
    const ctx = await boot();
    await createTestAccount(ctx.database.handle, { email: 'admin@example.test', role: 'admin' }, ctx.clock.fn);
    const response = await login(ctx, 'admin@example.test', TEST_PASSWORD);
    expect(response.statusCode).toBe(200);
    expect(SessionResponseSchema.parse(response.json())).toMatchObject({ authenticated: true, authMode: 'local', account: { role: 'admin' } });
  });

  it('refuses seller and manager with the correct password, identically to a wrong password or an unknown e-mail', async () => {
    const ctx = await boot();
    await createTestAccount(ctx.database.handle, { email: 'seller@example.test', role: 'seller' }, ctx.clock.fn);
    await createTestAccount(ctx.database.handle, { email: 'manager@example.test', role: 'manager' }, ctx.clock.fn);
    await createTestAccount(ctx.database.handle, { email: 'admin@example.test', role: 'admin' }, ctx.clock.fn);

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
    await createTestAccount(ctx.database.handle, { email: 'seller@example.test', role: 'seller' }, ctx.clock.fn);
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
    await createTestAccount(ctx.database.handle, { email: 'admin@example.test', role: 'admin' }, ctx.clock.fn);
    for (let attempt = 1; attempt <= DEFAULT_ACCOUNT_THROTTLE.maxFailures; attempt += 1) {
      await login(ctx, 'admin@example.test', WRONG_PASSWORD, { remoteAddress: `10.9.2.${attempt}` });
    }
    expect((await login(ctx, 'admin@example.test', TEST_PASSWORD, { remoteAddress: '10.9.2.99' })).statusCode).toBe(429);
  });

  it('does not resolve a session of an operational account that predates the mode', async () => {
    const dev = await startAuthApp(postgres, opened);
    await createTestAccount(dev.database.handle, { email: 'seller@example.test', role: 'seller' }, dev.clock.fn);
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
    await createTestAccount(dev.database.handle, { email: 'seller@example.test', role: 'seller' }, dev.clock.fn);
    await createTestAccount(dev.database.handle, { email: 'admin@example.test', role: 'admin' }, dev.clock.fn);
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
});
