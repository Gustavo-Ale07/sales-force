import { APP_NOT_PERMITTED_MESSAGE, ApiErrorSchema } from '@salesforce/contracts';
import { auditLog, session } from '@salesforce/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_PASSWORD, WRONG_PASSWORD, createTestAccount, setCookieHeaders } from '../helpers/auth.js';
import { login, startAuthApp } from '../helpers/auth-app.js';
import { startPostgres, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];

beforeAll(async () => {
  postgres = await startPostgres();
});
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

/** App login matrix: `client: 'app'` is refused for profiles without mobile use, after valid credentials (P-21, server-side). */
describe('POST /auth/login with client=app', () => {
  it('refuses technical with app_not_permitted (403), audits it, opens no session; the site still works', async () => {
    const ctx = await startAuthApp(postgres, opened);
    await createTestAccount(ctx.database.handle, { username: 'tec@example.test', role: 'technical' }, ctx.clock.fn);

    const refused = await login(ctx, 'tec@example.test', TEST_PASSWORD, { client: 'app', remoteAddress: '10.9.0.1' });
    expect(refused.statusCode).toBe(403);
    expect(setCookieHeaders(refused)).toEqual([]);
    const error = ApiErrorSchema.parse(refused.json());
    expect(error.code).toBe('app_not_permitted');
    expect(error.message).toBe(APP_NOT_PERMITTED_MESSAGE);
    expect(await ctx.database.handle.db.select().from(session)).toHaveLength(0);
    const rows = (await ctx.database.handle.db.select().from(auditLog)).filter((row) => row.action === 'auth.login.app_not_permitted');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail).toMatchObject({ role: 'technical', method: 'local' });

    const web = await login(ctx, 'tec@example.test', TEST_PASSWORD, { remoteAddress: '10.9.0.2' });
    expect(web.statusCode).toBe(200);
    const explicitWeb = await login(ctx, 'tec@example.test', TEST_PASSWORD, { client: 'web', remoteAddress: '10.9.0.3' });
    expect(explicitWeb.statusCode).toBe(200);
  });

  it('does not reveal the profile to someone without the password (wrong password stays invalid_credentials)', async () => {
    const ctx = await startAuthApp(postgres, opened);
    await createTestAccount(ctx.database.handle, { username: 'tec@example.test', role: 'technical' }, ctx.clock.fn);
    const wrong = await login(ctx, 'tec@example.test', WRONG_PASSWORD, { client: 'app', remoteAddress: '10.9.1.1' });
    expect(wrong.statusCode).toBe(401);
    expect(ApiErrorSchema.parse(wrong.json()).code).toBe('invalid_credentials');
  });

  it('allows admin and manager on the app', async () => {
    const ctx = await startAuthApp(postgres, opened);
    await createTestAccount(ctx.database.handle, { username: 'adm@example.test', role: 'admin' }, ctx.clock.fn);
    await createTestAccount(ctx.database.handle, { username: 'mgr@example.test', role: 'manager' }, ctx.clock.fn);
    expect((await login(ctx, 'adm@example.test', TEST_PASSWORD, { client: 'app', remoteAddress: '10.9.2.1', device: { installId: 'install-adm-0001', label: 'Android', platform: 'android' } })).statusCode).toBe(200);
    expect((await login(ctx, 'mgr@example.test', TEST_PASSWORD, { client: 'app', remoteAddress: '10.9.2.2', device: { installId: 'install-mgr-0001', label: 'Android', platform: 'android' } })).statusCode).toBe(200);
  });
});
