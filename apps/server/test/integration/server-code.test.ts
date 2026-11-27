import { SERVER_CODE_HEADER, decodeServerCode } from '@salesforce/contracts';
import { auditLog, authThrottle, serverCode, session } from '@salesforce/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_ORIGIN, TEST_PASSWORD, createTestAccount, sessionCookieOf } from '../helpers/auth.js';
import { NO_SERVER_CODE, TEST_SERVER_CODE_SECRET, login, loginCookie, startAuthApp } from '../helpers/auth-app.js';
import { AuditService } from '../../src/iam/audit.service.js';
import { ServerCodeRepository } from '../../src/iam/server-code.repository.js';
import { ServerCodeService, hashServerCodeSecret } from '../../src/iam/server-code.service.js';
import { SessionRepository } from '../../src/iam/session.repository.js';
import { ThrottleRepository } from '../../src/iam/throttle.repository.js';
import { startPostgres, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];

beforeAll(async () => {
  postgres = await startPostgres();
});
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const WRONG_SECRET = 'w'.repeat(43);
const API_URL = 'https://api.exemplo.test';

/** Server code (owner ruling 2026-11-27): a global guard before auth; only the probes are exempt. */
describe('server code guard', () => {
  it('refuses a request with no code: bare 401, no body, on login and on every route; the probes stay open', async () => {
    const ctx = await startAuthApp(postgres, opened);
    await createTestAccount(ctx.database.handle, { username: 'adm@example.test', role: 'admin' }, ctx.clock.fn);

    const noLogin = await login(ctx, 'adm@example.test', TEST_PASSWORD, { headers: { [SERVER_CODE_HEADER]: NO_SERVER_CODE } });
    expect(noLogin.statusCode).toBe(401);
    expect(noLogin.body).toBe('');
    expect(await ctx.database.handle.db.select().from(session)).toHaveLength(0);

    const session1 = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { [SERVER_CODE_HEADER]: NO_SERVER_CODE } });
    expect(session1.statusCode).toBe(401);
    expect(session1.body).toBe('');

    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/health', headers: { [SERVER_CODE_HEADER]: NO_SERVER_CODE } })).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/ready', headers: { [SERVER_CODE_HEADER]: NO_SERVER_CODE } })).statusCode).not.toBe(401);
  });

  it('refuses a wrong code the same way (indistinguishable from a missing one)', async () => {
    const ctx = await startAuthApp(postgres, opened);
    await createTestAccount(ctx.database.handle, { username: 'adm@example.test', role: 'admin' }, ctx.clock.fn);
    const wrong = await login(ctx, 'adm@example.test', TEST_PASSWORD, { headers: { [SERVER_CODE_HEADER]: WRONG_SECRET } });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.body).toBe('');
    const malformed = await login(ctx, 'adm@example.test', TEST_PASSWORD, { headers: { [SERVER_CODE_HEADER]: 'not-a-secret' } });
    expect(malformed.statusCode).toBe(401);
    expect(malformed.body).toBe('');
  });

  it('accepts the right code on login and on session renewal; the check route answers 204', async () => {
    const ctx = await startAuthApp(postgres, opened);
    await createTestAccount(ctx.database.handle, { username: 'adm@example.test', role: 'admin' }, ctx.clock.fn);

    const ok = await login(ctx, 'adm@example.test', TEST_PASSWORD, { headers: { [SERVER_CODE_HEADER]: TEST_SERVER_CODE_SECRET } });
    expect(ok.statusCode).toBe(200);
    const cookie = sessionCookieOf(ok);

    const renewed = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie, [SERVER_CODE_HEADER]: TEST_SERVER_CODE_SECRET } });
    expect(renewed.statusCode).toBe(200);
    const renewedWithout = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie, [SERVER_CODE_HEADER]: NO_SERVER_CODE } });
    expect(renewedWithout.statusCode).toBe(401);

    const check = await ctx.app.inject({ method: 'GET', url: '/api/v1/server-code/check' });
    expect(check.statusCode).toBe(204);
    const checkWrong = await ctx.app.inject({ method: 'GET', url: '/api/v1/server-code/check', headers: { [SERVER_CODE_HEADER]: WRONG_SECRET } });
    expect(checkWrong.statusCode).toBe(401);
  });

  it('fails closed when no code was ever generated', async () => {
    const ctx = await startAuthApp(postgres, opened);
    await ctx.database.handle.db.delete(serverCode);
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/server-code/check' });
    expect(response.statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(200);
  });

  it('answers 429 (no body) to a wrong code from an address that keeps failing, while the right code still passes from it', async () => {
    const ctx = await startAuthApp(postgres, opened);
    for (let i = 0; i < 20; i += 1) {
      const r = await ctx.app.inject({ method: 'GET', url: '/api/v1/server-code/check', remoteAddress: '10.20.0.1', headers: { [SERVER_CODE_HEADER]: WRONG_SECRET } });
      expect(r.statusCode).toBe(401);
    }
    const blocked = await ctx.app.inject({ method: 'GET', url: '/api/v1/server-code/check', remoteAddress: '10.20.0.1', headers: { [SERVER_CODE_HEADER]: WRONG_SECRET } });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.body).toBe('');
    expect(await ctx.database.handle.db.select().from(authThrottle)).not.toHaveLength(0);
    // Only failures are limited: the correct code passes from the blocked address.
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/server-code/check', remoteAddress: '10.20.0.1' })).statusCode).toBe(204);
    // Another address is unaffected.
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/server-code/check', remoteAddress: '10.20.0.2' })).statusCode).toBe(204);
  });
});

describe('server code rotation (operator CLI service; there is no HTTP route)', () => {
  function serviceOf(ctx: Awaited<ReturnType<typeof startAuthApp>>): ServerCodeService {
    const db = ctx.database.handle.db;
    return new ServerCodeService(new ServerCodeRepository(db), new SessionRepository(db), new AuditService(db, ctx.clock.fn), new ThrottleRepository(db), ctx.clock.fn);
  }

  it('has no HTTP route to rotate or read the code', async () => {
    const ctx = await startAuthApp(postgres, opened);
    await createTestAccount(ctx.database.handle, { username: 'adm@example.test', role: 'admin' }, ctx.clock.fn);
    const cookie = await loginCookie(ctx, 'adm@example.test', TEST_PASSWORD);
    const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/server-code/rotate', headers: { origin: TEST_ORIGIN, cookie } });
    expect(response.statusCode).toBe(404);
  });

  it('generates a code the guard accepts, makes the old one 401, revokes every session and audits without the value', async () => {
    const ctx = await startAuthApp(postgres, opened);
    await createTestAccount(ctx.database.handle, { username: 'adm@example.test', role: 'admin' }, ctx.clock.fn);
    const adminCookie = await loginCookie(ctx, 'adm@example.test', TEST_PASSWORD);

    const { code, revokedSessions } = await serviceOf(ctx).rotate(API_URL);
    expect(revokedSessions).toBe(1);
    const decoded = decodeServerCode(code);
    expect(decoded?.a).toBe(API_URL);
    const newSecret = decoded?.k ?? '';

    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/server-code/check' })).statusCode).toBe(401);
    const afterRotation = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: adminCookie, [SERVER_CODE_HEADER]: newSecret } });
    expect(afterRotation.json<{ authenticated: boolean }>().authenticated).toBe(false);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/server-code/check', headers: { [SERVER_CODE_HEADER]: newSecret } })).statusCode).toBe(204);
    expect((await login(ctx, 'adm@example.test', TEST_PASSWORD, { headers: { [SERVER_CODE_HEADER]: newSecret } })).statusCode).toBe(200);

    const rows = await ctx.database.handle.db.select().from(serverCode);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(newSecret);
    const audit = (await ctx.database.handle.db.select().from(auditLog)).filter((row) => row.action === 'config.server_code_rotated');
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorAccountId).toBeNull();
    expect(audit[0]?.detail).toMatchObject({ actor: 'cli', revokedSessions: 1 });
    expect(JSON.stringify(audit)).not.toContain(newSecret);
  });

  it('releases the addresses blocked by the old code', async () => {
    const ctx = await startAuthApp(postgres, opened);
    for (let i = 0; i < 21; i += 1) await ctx.app.inject({ method: 'GET', url: '/api/v1/server-code/check', remoteAddress: '10.20.1.1', headers: { [SERVER_CODE_HEADER]: WRONG_SECRET } });
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/server-code/check', remoteAddress: '10.20.1.1', headers: { [SERVER_CODE_HEADER]: WRONG_SECRET } })).statusCode).toBe(429);
    const { code } = await serviceOf(ctx).rotate(API_URL);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/server-code/check', remoteAddress: '10.20.1.1', headers: { [SERVER_CODE_HEADER]: WRONG_SECRET } })).statusCode).toBe(401);
    expect(decodeServerCode(code)).not.toBeNull();
  });

  it('describes the active code with a short hash prefix only, and reports none when absent', async () => {
    const ctx = await startAuthApp(postgres, opened);
    const service = serviceOf(ctx);
    const active = await service.describeActive();
    expect(active?.hashPrefix).toHaveLength(8);
    expect(active?.hashPrefix).toBe(hashServerCodeSecret(TEST_SERVER_CODE_SECRET).slice(0, 8));
    await ctx.database.handle.db.delete(serverCode);
    expect(await service.describeActive()).toBeNull();
  });
});
