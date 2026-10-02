import { Controller, Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  ApiErrorSchema,
  HealthResponseSchema,
  ReadyResponseSchema,
  routes,
  type ReadyResponse,
} from '@salesforce/contracts';
import { createDb, MIGRATION_TABLE } from '@salesforce/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApiApp } from '../../src/api/create-app.js';
import { ApiRoute, Contract } from '../../src/http/route.js';
import { authorizeRoute } from '../../src/iam/policy.js';
import { createLogger } from '../../src/observability/logger.js';
import { recordWorkerHeartbeat } from '../../src/platform/worker-heartbeat.js';
import { createTestAccount, TEST_PASSWORD, TestClock, testAuthConfig } from '../helpers/auth.js';
import { loginCookie } from '../helpers/auth-app.js';
import {
  captureLogs,
  createMigratedDatabase,
  startPostgres,
  type MigratedDatabase,
  type TestPostgres,
} from '../helpers/postgres.js';

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];

beforeAll(async () => {
  postgres = await startPostgres();
});

afterAll(async () => {
  for (const close of opened.reverse()) await close();
  await postgres.stop();
});

async function apiOver(database: MigratedDatabase, options: { level?: string; readinessCacheTtlMs?: number; clock?: () => Date } = {}) {
  const capture = captureLogs();
  const logger = createLogger({ level: options.level ?? 'info', service: 'api', destination: capture.stream });
  const app = await createApiApp({
    logger,
    db: database.handle,
    auth: testAuthConfig(),
    ...(options.readinessCacheTtlMs === undefined ? {} : { readinessCacheTtlMs: options.readinessCacheTtlMs }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  opened.push(() => app.close());
  return { app, capture };
}

async function freshApi() {
  const database = await createMigratedDatabase(postgres);
  opened.push(() => database.handle.close());
  return { database, ...(await apiOver(database)) };
}

const READY_URL = '/api/v1/ready';

/** A signed-in administrator's cookie: /ready shows detail only to an active session. */
async function adminCookie(app: NestFastifyApplication, database: MigratedDatabase): Promise<string> {
  await createTestAccount(database.handle, { email: 'ready-admin@example.test', role: 'admin' });
  return loginCookie({ app }, 'ready-admin@example.test', TEST_PASSWORD);
}

const readyWith = (app: NestFastifyApplication, cookie?: string) =>
  app.inject({ method: 'GET', url: READY_URL, headers: cookie === undefined ? {} : { cookie } });

describe('GET /api/v1/health', () => {
  it('answers ok without touching the database, and returns a generated correlation id', async () => {
    // A pool that can never connect proves liveness does not depend on the database.
    const dead = createDb('postgres://nobody:nothing@127.0.0.1:1/none', { max: 1 });
    opened.push(() => dead.close());
    const capture = captureLogs();
    const app = await createApiApp({
      logger: createLogger({ level: 'info', service: 'api', destination: capture.stream }),
      db: dead,
      auth: testAuthConfig(),
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    opened.push(() => app.close());

    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.statusCode).toBe(200);
    expect(HealthResponseSchema.parse(response.json())).toEqual({ status: 'ok' });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('echoes a well-formed inbound x-request-id and puts it in every log line of the request', async () => {
    const { app, capture } = await freshApi();
    const response = await app.inject({ method: 'GET', url: '/api/v1/health', headers: { 'x-request-id': 'trace-abc-123456' } });
    expect(response.headers['x-request-id']).toBe('trace-abc-123456');

    const lines = capture.lines().filter((line) => line['requestId'] === 'trace-abc-123456');
    expect(lines.length).toBeGreaterThanOrEqual(2); // incoming request + request completed
    for (const line of capture.lines().filter((entry) => typeof entry['req'] === 'object')) {
      expect(line['requestId']).toBeDefined();
    }
    // Only method and path of the request are logged.
    expect(lines.find((line) => line['req'])?.['req']).toEqual({ method: 'GET', url: '/api/v1/health' });
  });

  it('replaces a malformed inbound id instead of trusting it', async () => {
    const { app } = await freshApi();
    const response = await app.inject({ method: 'GET', url: '/api/v1/health', headers: { 'x-request-id': 'bad id\twith spaces' } });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('GET /api/v1/ready', () => {
  it('is degraded (200) while the worker has not reported, never not_ready because of the integration', async () => {
    const { app } = await freshApi();
    const response = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(response.statusCode).toBe(200);
    const body: ReadyResponse = ReadyResponseSchema.parse(response.json());
    expect(body.status).toBe('degraded');
    expect(body.checks.database).toBe('ok');
    expect(body.checks.migrations.status).toBe('ok');
    expect(body.integration.state).toBe('not_configured');
  });

  it('is ready once the worker heartbeat exists, and reports the worker gateway mode', async () => {
    const { app, database } = await freshApi();
    await recordWorkerHeartbeat(database.handle.db, { gatewayMode: 'fake', startedAt: new Date().toISOString() }, new Date());
    const response = await readyWith(app, await adminCookie(app, database));
    expect(response.statusCode).toBe(200);
    expect(ReadyResponseSchema.parse(response.json())).toMatchObject({
      status: 'ready',
      integration: { state: 'ok', gatewayMode: 'fake' },
    });
  });

  it.each(['seller', 'manager'] as const)(
    'gives a signed-in %s only the coarse verdict: integration detail is for admin and technical only (getConfiguration)',
    async (role) => {
      const { app, database } = await freshApi();
      await recordWorkerHeartbeat(database.handle.db, { gatewayMode: 'live', startedAt: new Date().toISOString() }, new Date());
      await database.handle.pool.query(`insert into sync_state (entity, status) values ('customers', 'failed')`);
      await createTestAccount(database.handle, { email: `ready-${role}@example.test`, role });
      const cookie = await loginCookie({ app }, `ready-${role}@example.test`, TEST_PASSWORD);
      const response = await readyWith(app, cookie);
      expect(response.statusCode).toBe(200);
      const body = ReadyResponseSchema.parse(response.json());
      // The placeholder mode, not the worker's `live`; no entity names, message, timestamp or counts.
      expect(body.integration.gatewayMode).toBe('unknown');
      expect(body.integration.failingEntities).toEqual([]);
      expect(body.integration.message).toBeNull();
      expect(body.integration.lastSuccessAt).toBeNull();
      expect(body.checks.migrations).toMatchObject({ applied: null, expected: null });
    },
  );

  it('shows the /ready detail to exactly the roles the central policy grants getConfiguration (matrix pin)', async () => {
    const { app, database } = await freshApi();
    await recordWorkerHeartbeat(database.handle.db, { gatewayMode: 'live', startedAt: new Date().toISOString() }, new Date());
    const sees = async (cookie?: string): Promise<boolean> => {
      const body = ReadyResponseSchema.parse((await readyWith(app, cookie)).json());
      return body.integration.gatewayMode === 'live';
    };
    const observed: Record<string, boolean> = { anonymous: await sees() };
    for (const role of ['admin', 'technical', 'manager', 'seller'] as const) {
      await createTestAccount(database.handle, { email: `matrix-${role}@example.test`, role });
      observed[role] = await sees(await loginCookie({ app }, `matrix-${role}@example.test`, TEST_PASSWORD));
    }
    // Pinned literally: widening or narrowing the grant must be a deliberate change of this test too.
    expect(observed).toEqual({ anonymous: false, admin: true, technical: true, manager: false, seller: false });
    // And tied to the policy table itself: the detail never drifts from the getConfiguration grant.
    for (const role of ['admin', 'technical', 'manager', 'seller'] as const) {
      expect(observed[role], role).toBe(authorizeRoute({ role, channel: 'web' }, 'getConfiguration').allowed);
    }
  });

  it('gives an admin whose session was revoked, or whose account was disabled, only the coarse verdict', async () => {
    const { app, database } = await freshApi();
    await recordWorkerHeartbeat(database.handle.db, { gatewayMode: 'live', startedAt: new Date().toISOString() }, new Date());
    const admin = await createTestAccount(database.handle, { email: 'ready-gone@example.test', role: 'admin' });
    const cookie = await loginCookie({ app }, 'ready-gone@example.test', TEST_PASSWORD);
    expect(ReadyResponseSchema.parse((await readyWith(app, cookie)).json()).integration.gatewayMode).toBe('live');

    await database.handle.pool.query('update session set revoked_at = now() where account_id = $1', [admin.id]);
    expect(ReadyResponseSchema.parse((await readyWith(app, cookie)).json()).integration.gatewayMode).toBe('unknown');

    const fresh = await loginCookie({ app }, 'ready-gone@example.test', TEST_PASSWORD);
    await database.handle.pool.query("update account set status = 'disabled' where id = $1", [admin.id]);
    expect(ReadyResponseSchema.parse((await readyWith(app, fresh)).json()).integration.gatewayMode).toBe('unknown');
  });

  it('does not slide the session when it only peeks at the role for /ready', async () => {
    const { app, database } = await freshApi();
    const cookie = await adminCookie(app, database);
    const read = () => database.handle.pool.query('select expires_at, last_seen_at from session');
    const before = await read();
    await readyWith(app, cookie);
    expect((await read()).rows).toEqual(before.rows);
  });

  it('is degraded when the worker heartbeat is stale or a mirror entity failed', async () => {
    const { app, database } = await freshApi();
    const cookie = await adminCookie(app, database);
    const old = new Date(Date.now() - 30 * 60_000);
    await recordWorkerHeartbeat(database.handle.db, { gatewayMode: 'fake', startedAt: old.toISOString() }, old);
    const stale = await readyWith(app, cookie);
    expect(stale.statusCode).toBe(200);
    expect(stale.json<ReadyResponse>()).toMatchObject({ status: 'degraded', integration: { state: 'degraded' } });

    await recordWorkerHeartbeat(database.handle.db, { gatewayMode: 'fake', startedAt: old.toISOString() }, new Date());
    await database.handle.pool.query(`insert into sync_state (entity, status) values ('customers', 'failed')`);
    const failing = await readyWith(app, cookie);
    expect(failing.statusCode).toBe(200);
    expect(failing.json<ReadyResponse>()).toMatchObject({
      status: 'degraded',
      integration: { failingEntities: ['customers'] },
    });
  });

  it('is not_ready (503) when a migration is missing, and ready when the database is ahead', async () => {
    const { app, database } = await freshApi();
    await recordWorkerHeartbeat(database.handle.db, { gatewayMode: 'fake', startedAt: new Date().toISOString() }, new Date());

    await database.handle.pool.query(`insert into ${MIGRATION_TABLE} (idx, tag, hash) values (9999, '9999_future', 'x')`);
    const ahead = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(ahead.statusCode).toBe(200);
    expect(ahead.json<ReadyResponse>()).toMatchObject({ status: 'ready', checks: { migrations: { status: 'ahead' } } });

    await database.handle.pool.query(`delete from ${MIGRATION_TABLE} where idx = 9999`);
    await database.handle.pool.query(`delete from ${MIGRATION_TABLE} where idx = (select max(idx) from ${MIGRATION_TABLE})`);
    const behind = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(behind.statusCode).toBe(503);
    expect(ReadyResponseSchema.parse(behind.json())).toMatchObject({
      status: 'not_ready',
      checks: { database: 'ok', migrations: { status: 'behind' } },
    });
  });

  it('is not_ready (503) when the database is unreachable, without leaking the connection error', async () => {
    const dead = createDb('postgres://nobody:secret-password-1@127.0.0.1:1/none', { max: 1 });
    opened.push(() => dead.close());
    const capture = captureLogs();
    const app = await createApiApp({
      logger: createLogger({ level: 'info', service: 'api', destination: capture.stream }),
      db: dead,
      auth: testAuthConfig(),
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    opened.push(() => app.close());

    const response = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(response.statusCode).toBe(503);
    expect(ReadyResponseSchema.parse(response.json())).toMatchObject({
      status: 'not_ready',
      checks: { database: 'fail' },
    });
    expect(response.body).not.toMatch(/ECONNREFUSED|secret-password-1|127\.0\.0\.1/);
    expect(JSON.stringify(capture.lines())).not.toContain('secret-password-1');
  });
});

describe('GET /api/v1/ready disclosure and cost (A7)', () => {
  it('gives an anonymous caller only the coarse verdict: no counts, no entity names, no messages', async () => {
    const { app, database } = await freshApi();
    const old = new Date(Date.now() - 30 * 60_000);
    await recordWorkerHeartbeat(database.handle.db, { gatewayMode: 'fake', startedAt: old.toISOString() }, new Date());
    await database.handle.pool.query(`insert into sync_state (entity, status, last_error_message) values ('customers', 'failed', 'detalhe interno')`);

    const anonymous = await readyWith(app);
    expect(anonymous.statusCode).toBe(200);
    const coarse = ReadyResponseSchema.parse(anonymous.json());
    expect(coarse.status).toBe('degraded');
    expect(coarse.checks.database).toBe('ok');
    expect(coarse.checks.migrations).toEqual({ status: 'ok', applied: null, expected: null });
    expect(coarse.integration).toMatchObject({ state: 'degraded', lastSuccessAt: null, failingEntities: [], message: null });
    expect(anonymous.body).not.toContain('customers');
    expect(anonymous.body).not.toContain('detalhe interno');

    // The same instance shows the detail to an active session (the web pill).
    const detailed = ReadyResponseSchema.parse((await readyWith(app, await adminCookie(app, database))).json());
    expect(detailed.integration.failingEntities).toEqual(['customers']);
    expect(detailed.checks.migrations.applied).not.toBeNull();
  });

  it('treats an unknown, expired-looking or duplicated session cookie as anonymous', async () => {
    const { app, database } = await freshApi();
    const cookie = await adminCookie(app, database);
    for (const header of [`sf_session=${'a'.repeat(43)}`, 'sf_session=nonsense', `${cookie}; ${cookie}`]) {
      const body = ReadyResponseSchema.parse((await readyWith(app, header)).json());
      expect(body.checks.migrations.applied, header).toBeNull();
    }
  });

  it('does not slide the session when it is only used to read /ready', async () => {
    const database = await createMigratedDatabase(postgres);
    opened.push(() => database.handle.close());
    const clock = new TestClock();
    const { app } = await apiOver(database, { clock: clock.fn });
    const cookie = await adminCookie(app, database);
    const before = await database.handle.pool.query('select expires_at from session');
    clock.advance(10 * 60_000);
    await readyWith(app, cookie);
    const after = await database.handle.pool.query('select expires_at from session');
    expect(after.rows).toEqual(before.rows);
  });

  it('serves repeated calls inside the cache window from memory, and refreshes after it', async () => {
    const database = await createMigratedDatabase(postgres);
    opened.push(() => database.handle.close());
    const clock = new TestClock();
    const { app } = await apiOver(database, { clock: clock.fn, readinessCacheTtlMs: 3000 });
    const cookie = await adminCookie(app, database);

    const first = await readyWith(app, cookie);
    expect(first.json<ReadyResponse>().integration.failingEntities).toEqual([]);
    await database.handle.pool.query(`insert into sync_state (entity, status) values ('products', 'failed')`);

    clock.advance(1000);
    const cached = await readyWith(app, cookie);
    expect(cached.json<ReadyResponse>().integration.failingEntities).toEqual([]);

    clock.advance(2500);
    const fresh = await readyWith(app, cookie);
    expect(fresh.json<ReadyResponse>().integration.failingEntities).toEqual(['products']);
  });

  it('runs one check for a burst of concurrent calls (single flight)', async () => {
    const database = await createMigratedDatabase(postgres);
    opened.push(() => database.handle.close());
    const { app } = await apiOver(database, { readinessCacheTtlMs: 3000 });
    const cookie = await adminCookie(app, database);
    const spy = vi.spyOn(database.handle.pool, 'query');
    try {
      const responses = await Promise.all(Array.from({ length: 25 }, () => readyWith(app, cookie)));
      expect(responses.every((response) => response.statusCode === 200)).toBe(true);
      const readinessQueries = spy.mock.calls.filter((call) => String(typeof call[0] === 'string' ? call[0] : (call[0] as { text?: string })?.text).includes('to_regclass'));
      expect(readinessQueries.length).toBeLessThanOrEqual(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('never caches a failure: a database that comes back is reported on the next call', async () => {
    const database = await createMigratedDatabase(postgres);
    opened.push(() => database.handle.close());
    const clock = new TestClock();
    const { app } = await apiOver(database, { clock: clock.fn, readinessCacheTtlMs: 3000 });
    const spy = vi.spyOn(database.handle.pool, 'query').mockRejectedValueOnce(new Error('connection refused'));
    try {
      expect((await readyWith(app)).statusCode).toBe(503);
    } finally {
      spy.mockRestore();
    }
    expect((await readyWith(app)).statusCode).toBe(200);
  });
});

describe('error contract over HTTP', () => {
  it('answers an unknown route with the ApiError contract, the pt-BR message and the request id', async () => {
    const { app } = await freshApi();
    const response = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist', headers: { 'x-request-id': 'trace-404-000001' } });
    expect(response.statusCode).toBe(404);
    expect(response.headers['x-request-id']).toBe('trace-404-000001');
    expect(ApiErrorSchema.parse(response.json())).toMatchObject({
      code: 'not_found',
      message: 'Recurso não encontrado.',
      details: { requestId: 'trace-404-000001' },
    });
    expect(response.body).not.toMatch(/Cannot GET|stack/);
  });

  it('answers malformed JSON and oversized bodies as validation_failed without framework text', async () => {
    const { app } = await freshApi();
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/v1/health',
      headers: { 'content-type': 'application/json' },
      payload: '{ not json',
    });
    expect(malformed.statusCode).toBeGreaterThanOrEqual(400);
    expect(ApiErrorSchema.safeParse(malformed.json()).success).toBe(true);
    expect(malformed.body).not.toMatch(/Unexpected token|FST_ERR/);
  });
});

/* ---------- registry-driven validation (test-only controllers) ---------- */

@Controller('probe-leak')
class LeakController {
  @ApiRoute(routes.getHealth)
  leak() {
    // `costPrice` is not part of the contract: it must never leave the API (P-20).
    return { status: 'ok', costPrice: '12.345678', margin: '0.31' };
  }
}

@Controller('probe-bad')
class BadResponseController {
  @ApiRoute(routes.getHealth)
  bad() {
    return { status: 'maybe' };
  }
}

@Controller('probe-input')
class InputController {
  @ApiRoute(routes.getCustomer)
  customer(@Contract() contract: { params: { code: number } }) {
    return { received: contract.params.code };
  }

  @ApiRoute(routes.listCustomers)
  customers() {
    return {};
  }
}

@Module({ controllers: [LeakController, BadResponseController, InputController] })
class ProbeModule {}

describe('registry-driven request and response validation', () => {
  let app: NestFastifyApplication;
  let capture: ReturnType<typeof captureLogs>;

  beforeAll(async () => {
    const database = await createMigratedDatabase(postgres);
    opened.push(() => database.handle.close());
    capture = captureLogs();
    app = await createApiApp({
      logger: createLogger({ level: 'info', service: 'api', destination: capture.stream }),
      db: database.handle,
      auth: testAuthConfig(),
      rootModule: ProbeModule,
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    opened.push(() => app.close());
  });

  it('strips fields that are not in the response contract', async () => {
    const response = await app.inject({ method: 'GET', url: '/probe-leak/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(response.body).not.toMatch(/costPrice|margin/);
  });

  it('turns a response that violates its contract into internal_error and logs field paths only', async () => {
    const response = await app.inject({ method: 'GET', url: '/probe-bad/health' });
    expect(response.statusCode).toBe(500);
    expect(ApiErrorSchema.parse(response.json()).code).toBe('internal_error');
    const line = capture.lines().find((entry) => entry['msg'] === 'response violates its contract');
    expect(line).toMatchObject({ operationId: 'getHealth', issues: ['status: invalid_value'] });
    expect(JSON.stringify(line)).not.toContain('maybe');
  });

  it('validates path parameters and query strings with the registry schemas', async () => {
    const badParam = await app.inject({ method: 'GET', url: '/probe-input/customers/not-a-number' });
    expect(badParam.statusCode).toBe(400);
    const body = ApiErrorSchema.parse(badParam.json());
    expect(body.code).toBe('validation_failed');
    expect(body.details?.['issues']).toEqual([expect.objectContaining({ path: 'code' })]);
    expect(badParam.body).not.toContain('not-a-number');

    const badQuery = await app.inject({ method: 'GET', url: '/probe-input/customers?sellerCode=-5' });
    expect(badQuery.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(badQuery.json()).details?.['issues']).toEqual([
      expect.objectContaining({ path: 'sellerCode' }),
    ]);
  });
});
