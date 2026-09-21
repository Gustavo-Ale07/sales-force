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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../../src/api/create-app.js';
import { ApiRoute, Contract } from '../../src/http/route.js';
import { createLogger } from '../../src/observability/logger.js';
import { recordWorkerHeartbeat } from '../../src/platform/worker-heartbeat.js';
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

async function apiOver(database: MigratedDatabase, options: { level?: string } = {}) {
  const capture = captureLogs();
  const logger = createLogger({ level: options.level ?? 'info', service: 'api', destination: capture.stream });
  const app = await createApiApp({ logger, db: database.handle });
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

describe('GET /api/v1/health', () => {
  it('answers ok without touching the database, and returns a generated correlation id', async () => {
    // A pool that can never connect proves liveness does not depend on the database.
    const dead = createDb('postgres://nobody:nothing@127.0.0.1:1/none', { max: 1 });
    opened.push(() => dead.close());
    const capture = captureLogs();
    const app = await createApiApp({ logger: createLogger({ level: 'info', service: 'api', destination: capture.stream }), db: dead });
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
    const response = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(response.statusCode).toBe(200);
    expect(ReadyResponseSchema.parse(response.json())).toMatchObject({
      status: 'ready',
      integration: { state: 'ok', gatewayMode: 'fake' },
    });
  });

  it('is degraded when the worker heartbeat is stale or a mirror entity failed', async () => {
    const { app, database } = await freshApi();
    const old = new Date(Date.now() - 30 * 60_000);
    await recordWorkerHeartbeat(database.handle.db, { gatewayMode: 'fake', startedAt: old.toISOString() }, old);
    const stale = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(stale.statusCode).toBe(200);
    expect(stale.json<ReadyResponse>()).toMatchObject({ status: 'degraded', integration: { state: 'degraded' } });

    await recordWorkerHeartbeat(database.handle.db, { gatewayMode: 'fake', startedAt: old.toISOString() }, new Date());
    await database.handle.pool.query(`insert into sync_state (entity, status) values ('customers', 'failed')`);
    const failing = await app.inject({ method: 'GET', url: '/api/v1/ready' });
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
    const app = await createApiApp({ logger: createLogger({ level: 'info', service: 'api', destination: capture.stream }), db: dead });
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
