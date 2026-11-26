import { randomUUID } from 'node:crypto';
import { auditLog, device, erpForceConfig, session } from '@salesforce/db';
import { DEMO_ACCOUNT_EMAILS } from '@salesforce/sankhya';
import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_ORIGIN, TEST_PASSWORD } from '../helpers/auth.js';
import { startCommercialApp, type CommercialApp, type Who } from '../helpers/commercial-app.js';
import { startPostgres, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

/**
 * AUTH-1/AUTH-2 (PROPOSED), RF-IAM-7/8, W-36: registration at the app login, approval and revocation by admin or the team's manager,
 * the per-request device gate (pending = no business data, revoked = wipe signal), the offline-limit setting and the audit trail.
 */
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let app: CommercialApp;

beforeAll(async () => {
  postgres = await startPostgres();
  app = await startCommercialApp(postgres, opened);
});

// One approved device per account: every test starts without devices so earlier registrations never turn a later one pending.
beforeEach(async () => {
  await app.database.handle.db.delete(device);
});

afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const db = () => app.database.handle.db;
const idOf = (who: Who) => app.accounts.ids[DEMO_ACCOUNT_EMAILS[who]]!;
const install = () => `inst-${randomUUID()}`;

function appLogin(who: Who, registration?: { installId: string; label?: string }) {
  return app.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { 'content-type': 'application/json', origin: TEST_ORIGIN },
    payload: JSON.stringify({
      username: DEMO_ACCOUNT_EMAILS[who],
      password: TEST_PASSWORD,
      client: 'app',
      ...(registration === undefined ? {} : { device: { installId: registration.installId, label: registration.label ?? 'Aparelho de teste', platform: 'android' } }),
    }),
  });
}

function cookieOf(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const first = Array.isArray(raw) ? String(raw[0]) : String(raw);
  return first.split(';')[0]!;
}

function asCookie(cookie: string, method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) {
  return app.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { origin: TEST_ORIGIN, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
}

/** A device row for a demo account and the account's existing session pointed at it (the seller cannot log in with a local password, AUTH-6). */
async function attachDevice(who: Who, status: 'pending' | 'approved' | 'revoked') {
  const id = randomUUID();
  await db().insert(device).values({ id, accountId: idOf(who), installId: install(), label: 'Aparelho do vendedor', platform: 'android', status });
  await db().update(session).set({ deviceId: id }).where(eq(session.accountId, idOf(who)));
  return id;
}

async function auditActions(action: string) {
  return db().select().from(auditLog).where(eq(auditLog.action, action));
}

describe('registration at the app login', () => {
  it('an admin device is approved on registration and the session reports it with the offline limit', async () => {
    const response = await appLogin('admin', { installId: install() });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.device.status).toBe('approved');
    expect(body.device.offlineMaxDays).toBe(7);
    expect((await auditActions('device.registered')).length).toBeGreaterThan(0);
  });

  it('a manager device starts pending: the session opens but no business data is served', async () => {
    const response = await appLogin('manager', { installId: install() });
    expect(response.statusCode).toBe(200);
    expect(response.json().device.status).toBe('pending');
    const cookie = cookieOf(response);
    const business = await asCookie(cookie, 'GET', '/customers');
    expect(business.statusCode).toBe(403);
    expect(business.json().code).toBe('device_pending');
    expect((await asCookie(cookie, 'GET', '/devices/me')).json().device.status).toBe('pending');
    expect((await asCookie(cookie, 'POST', '/auth/logout')).statusCode).toBe(204);
  });

  it('registering the same installation again reuses the device', async () => {
    const installId = install();
    await appLogin('manager', { installId });
    await appLogin('manager', { installId });
    expect(await db().select().from(device).where(and(eq(device.accountId, idOf('manager')), eq(device.installId, installId)))).toHaveLength(1);
  });

  it('an app login without a device fails closed (device_required) and registers nothing', async () => {
    const before = (await db().select().from(device)).length;
    const refused = await appLogin('manager');
    expect(refused.statusCode).toBe(400);
    expect(refused.json().code).toBe('device_required');
    expect((await db().select().from(device)).length).toBe(before);
  });
});

describe('approval and revocation', () => {
  it('the admin approves a pending device and the owner can then work', async () => {
    const login = await appLogin('manager', { installId: install() });
    const cookie = cookieOf(login);
    const deviceId = login.json().device.id as string;
    const approved = await app.call('admin', 'POST', `/devices/${deviceId}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('approved');
    expect((await asCookie(cookie, 'GET', '/customers')).statusCode).toBe(200);
    const audit = (await auditActions('device.approved')).find((row) => (row.detail as { deviceId?: string }).deviceId === deviceId);
    expect(audit?.actorAccountId).toBe(idOf('admin'));
  });

  it('a manager manages the team (sellers) but never their own device, and a seller manages none', async () => {
    const sellerDevice = await attachDevice('seller1', 'pending');
    const own = await appLogin('manager', { installId: install() });
    expect((await app.call('manager', 'POST', `/devices/${own.json().device.id}/approve`)).status).toBe(404);
    expect((await app.call('seller1', 'POST', `/devices/${sellerDevice}/approve`)).status).toBe(403);
    expect((await app.call('seller1', 'GET', '/devices')).status).toBe(403);
    const listed = await app.call('manager', 'GET', '/devices');
    expect(listed.status).toBe(200);
    expect(listed.body.items.every((row: { accountId: string }) => row.accountId !== idOf('manager') && row.accountId !== idOf('admin'))).toBe(true);
    // The seller's session carries the pending device from here on: first the manager approves it.
    const approved = await app.call('manager', 'POST', `/devices/${sellerDevice}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.canManage).toBe(true);
  });

  it('refuses a second approved device for the account and approving twice (409, actionable message)', async () => {
    const first = await attachDevice('seller2', 'approved');
    const extra = randomUUID();
    await db().insert(device).values({ id: extra, accountId: idOf('seller2'), installId: install(), label: 'Outro aparelho', platform: 'ios', status: 'pending' });
    const blocked = await app.call('admin', 'POST', `/devices/${extra}/approve`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toContain('número máximo de aparelhos');
    expect((await app.call('admin', 'POST', `/devices/${first}/approve`)).status).toBe(409);
    expect((await app.call('admin', 'POST', `/devices/${randomUUID()}/approve`)).status).toBe(404);
  });
});

describe('revoked device', () => {
  it('does not sync, receives the wipe signal on every route but logout, and cannot log in again', async () => {
    const installId = install();
    const login = await appLogin('manager', { installId });
    const cookie = cookieOf(login);
    const deviceId = login.json().device.id as string;
    await app.call('admin', 'POST', `/devices/${deviceId}/approve`);
    expect((await asCookie(cookie, 'GET', '/sync/status')).statusCode).toBe(200);

    const revoked = await app.call('admin', 'POST', `/devices/${deviceId}/revoke`);
    expect(revoked.status).toBe(200);
    expect(revoked.body.status).toBe('revoked');

    for (const [method, url] of [['GET', '/sync/status'], ['GET', '/customers'], ['GET', '/devices/me'], ['GET', '/auth/session']] as const) {
      const response = await asCookie(cookie, method, url);
      expect(response.statusCode, url).toBe(401);
      expect(response.json().code, url).toBe('device_revoked');
    }
    const again = await appLogin('manager', { installId });
    expect(again.statusCode).toBe(401);
    expect(again.json().code).toBe('device_revoked');
    expect((await asCookie(cookie, 'POST', '/auth/logout')).statusCode).toBe(204);

    const audit = (await auditActions('device.revoked')).find((row) => (row.detail as { deviceId?: string }).deviceId === deviceId);
    expect(audit?.actorAccountId).toBe(idOf('admin'));
    expect((await app.call('admin', 'POST', `/devices/${deviceId}/approve`)).status).toBe(409);
  });

  it('audit rows never carry the installation id', async () => {
    const rows = await db().select().from(auditLog).where(like(auditLog.action, 'device.%'));
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows.map((row) => row.detail))).not.toContain('inst-');
  });
});

describe('offline limit (from the ERP) and devices per account (Configuracoes)', () => {
  it('days come from AD_FORCECFG (7 when empty) and are not editable; the device limit is admin only, validated and audited', async () => {
    const db = app.database.handle.db;
    expect((await app.call('manager', 'GET', '/device-settings')).status).toBe(403);
    expect((await app.call('manager', 'PUT', '/device-settings', { maxActiveDevices: 1 })).status).toBe(403);
    expect((await app.call('admin', 'GET', '/device-settings')).body).toEqual({ offlineMaxDays: 7, maxActiveDevices: 1 });
    expect((await app.call('admin', 'PUT', '/device-settings', { maxActiveDevices: 0 })).status).toBe(400);
    expect((await app.call('admin', 'PUT', '/device-settings', { offlineMaxDays: 3, maxActiveDevices: 2 })).status).toBe(400);
    expect((await app.call('admin', 'PUT', '/device-settings', { maxActiveDevices: 2 })).status).toBe(200);
    const audit = await auditActions('device.settings_changed');
    expect(audit.at(-1)?.detail).toMatchObject({ maxActiveDevices: 2, previousMaxActiveDevices: 1 });
    await db.insert(erpForceConfig).values({ id: 1, daysWithoutSync: 3, defaultPriceTableCode: null, contentHash: 'c1', syncedAt: new Date('2026-11-26T00:00:00.000Z') });
    expect((await appLogin('admin', { installId: install() })).json().device.offlineMaxDays).toBe(3);
    expect((await app.call('admin', 'GET', '/device-settings')).body).toEqual({ offlineMaxDays: 3, maxActiveDevices: 2 });
    await db.delete(erpForceConfig);
    await app.call('admin', 'PUT', '/device-settings', { maxActiveDevices: 1 });
  });
});

describe('sync report', () => {
  it('records the last synchronization of the device and ignores a future time', async () => {
    const login = await appLogin('admin', { installId: install() });
    const cookie = cookieOf(login);
    const deviceId = login.json().device.id as string;
    const past = new Date(app.clock.fn().getTime() - 3_600_000).toISOString();
    expect((await asCookie(cookie, 'POST', '/devices/me/sync', { syncedAt: past })).statusCode).toBe(204);
    const [row] = await db().select().from(device).where(eq(device.id, deviceId));
    expect(row?.lastSyncAt?.toISOString()).toBe(past);
    await asCookie(cookie, 'POST', '/devices/me/sync', { syncedAt: new Date(app.clock.fn().getTime() + 86_400_000).toISOString() });
    const [after] = await db().select().from(device).where(eq(device.id, deviceId));
    expect(after!.lastSyncAt!.getTime()).toBeLessThanOrEqual(app.clock.fn().getTime());
  });
});
