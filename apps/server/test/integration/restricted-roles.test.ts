import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, runMigrations, type DbHandle } from '@salesforce/db';
import { DEMO_ACCOUNTS, DEMO_ACCOUNT_EMAILS, DEMO_CONFIGURATION, FakeGateway, Secret, getDemoDataset } from '@salesforce/sankhya';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOperatorAccountService } from '../../src/cli/operator.js';
import { createLogger } from '../../src/observability/logger.js';
import { readWorkerHeartbeat } from '../../src/platform/worker-heartbeat.js';
import { loadCurrentReadScope } from '../../src/sync/mirror-scope.js';
import { MIRROR_ENTITIES, mirrorQueueName } from '../../src/sync/mirror-entities.js';
import { MirrorSyncService } from '../../src/sync/mirror-sync.service.js';
import { installQueues } from '../../src/worker/queue-installer.js';
import { WorkerRuntime } from '../../src/worker/runtime.js';
import { TEST_HASH_PARAMS, TEST_ORIGIN, TEST_PASSWORD } from '../helpers/auth.js';
import { loginCookie, startAuthApp, type AuthApp } from '../helpers/auth-app.js';
import { TEST_DATASET } from '../helpers/commercial-app.js';
import { storeConfiguration } from '../helpers/commercial-fixture.js';
import { startPostgres, type MigratedDatabase, type TestPostgres } from '../helpers/postgres.js';

/**
 * Real runtime paths under the least-privilege roles of deploy/staging/db-roles.sql (owner decision
 * 2026-10-02): the migrator migrates and installs the pg-boss schema; the worker runtime (pg-boss, mirror
 * sync, heartbeat) runs as force_worker; the API (HTTP flows and the account CLI service) runs as force_api.
 * The privilege matrix itself is proven in packages/db/tests/roles.test.ts.
 */
const ROLES_SQL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../deploy/staging/db-roles.sql');
const PASSWORDS = {
  force_migrator: `m-${randomBytes(6).toString('hex')}`,
  force_api: `a-${randomBytes(6).toString('hex')}`,
  force_worker: `w-${randomBytes(6).toString('hex')}`,
  force_backup: `b-${randomBytes(6).toString('hex')}`,
} as const;
type Role = keyof typeof PASSWORDS;

let postgres: TestPostgres;
let databaseUrl: string;
const closers: (() => Promise<unknown>)[] = [];

function roleUrl(role: Role): string {
  const u = new URL(databaseUrl);
  u.username = role;
  u.password = PASSWORDS[role];
  return u.toString();
}

async function applyRolesSql(): Promise<void> {
  const target = '/tmp/db-roles.sql';
  await postgres.container.copyContentToContainer([{ content: await readFile(ROLES_SQL, 'utf8'), target }]);
  const result = await postgres.container.exec([
    'psql', '-U', postgres.container.getUsername(), '-d', new URL(databaseUrl).pathname.slice(1), '-v', 'ON_ERROR_STOP=1',
    '-v', `migrator_password=${PASSWORDS.force_migrator}`, '-v', `api_password=${PASSWORDS.force_api}`, '-v', `worker_password=${PASSWORDS.force_worker}`,
    '-v', `backup_password=${PASSWORDS.force_backup}`,
    '-f', target,
  ]);
  expect(result.exitCode, result.output).toBe(0);
}

const handleFor = (role: Role, applicationName: string): DbHandle => {
  const handle = createDb(roleUrl(role), { max: 4, applicationName });
  closers.push(() => handle.close());
  return handle;
};

const logger = createLogger({ level: 'silent', service: 'worker' });
let migratorDb: DbHandle;
let workerDb: DbHandle;
let apiDb: DbHandle;
let runtime: WorkerRuntime;
let mirror: MirrorSyncService;
let api: AuthApp;
let configVersionId: string;

async function until<T>(read: () => Promise<T | undefined>, what: string, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

beforeAll(async () => {
  postgres = await startPostgres();
  databaseUrl = await postgres.createDatabase();
  // Deploy order: roles -> migrate (migrator) -> queue install (migrator) -> roles again -> runtime.
  await applyRolesSql();
  await runMigrations(roleUrl('force_migrator'), { log: () => undefined });
  await installQueues(new Secret(roleUrl('force_migrator')));
  await applyRolesSql();

  migratorDb = handleFor('force_migrator', 'sf-test-migrator');
  workerDb = handleFor('force_worker', 'sf-test-worker');
  apiDb = handleFor('force_api', 'sf-test-api');

  // The installation configuration has no runtime writer yet (UNDETERMINED 1 in db-roles.sql): the migrator loads it.
  configVersionId = await storeConfiguration(migratorDb);

  mirror = new MirrorSyncService({
    db: workerDb,
    gateway: new FakeGateway({ batchSize: 50 }),
    logger,
    now: () => new Date(),
    readScope: () => loadCurrentReadScope(workerDb.db),
  });
  runtime = new WorkerRuntime({
    logger,
    db: workerDb,
    now: () => new Date(),
    options: {
      databaseUrl: new Secret(roleUrl('force_worker')),
      heartbeatCron: '*/5 * * * *',
      shutdownTimeoutMs: 10_000,
      health: null,
      gatewayMode: 'fake',
      pollingIntervalSeconds: 0.5,
    },
    mirror: { service: mirror, schedules: Object.fromEntries(MIRROR_ENTITIES.map((e) => [e, null])) as never },
  });
  await runtime.start();
  closers.push(() => runtime.stop());

  // The account CLI service runs in the api container (README-staging): it creates the accounts as force_api.
  const { accounts, repository } = createOperatorAccountService(apiDb, TEST_HASH_PARAMS);
  for (const demo of DEMO_ACCOUNTS) {
    await accounts.createAccount({ email: demo.email, displayName: demo.displayName, role: demo.role, password: TEST_PASSWORD });
  }
  for (const link of DEMO_CONFIGURATION.customers.accountSellerLinks) {
    const account = await repository.findByEmail(link.accountEmail);
    if (account !== null) await accounts.linkSeller(account.id, link.sellerCode, configVersionId);
  }

  const database: MigratedDatabase = { url: roleUrl('force_api'), secret: new Secret(roleUrl('force_api')), handle: apiDb };
  api = await startAuthApp(postgres, closers, { database, dataset: TEST_DATASET });
});

afterAll(async () => {
  for (const close of closers.reverse()) await close();
  await postgres?.stop();
});

describe('worker runtime as force_worker', () => {
  it('starts on the installed queue schema, beats, and the API role can read the heartbeat', async () => {
    const beat = await readWorkerHeartbeat(apiDb.db);
    expect(beat?.cursor).toMatchObject({ gatewayMode: 'fake' });
  });

  it('mirrors every entity through the real writer (upserts, soft delete, temporary table) and through a pg-boss job', async () => {
    const run = await mirror.runAll();
    expect(run.failures).toEqual([]);
    expect(run.results).toHaveLength(MIRROR_ENTITIES.length);

    // The queue path: send, fetch, complete are pg-boss DML as force_worker.
    const second = await runtime.boss.send(mirrorQueueName('sellers'), {});
    expect(second).not.toBeNull();
    const job = await until(async () => {
      const rows = await migratorDb.pool.query<{ state: string }>('select state from pgboss.job where id = $1', [second]);
      return rows.rows[0]?.state === 'completed' ? rows.rows[0] : undefined;
    }, 'the sellers job to complete');
    expect(job.state).toBe('completed');
    expect((await apiDb.pool.query<{ n: number }>('select count(*)::int as n from erp_customer')).rows[0]?.n).toBeGreaterThan(0);
  });

  it('stops gracefully and can start again (pg-boss maintenance and shutdown need no DDL)', async () => {
    await runtime.stop();
    await runtime.start();
  });
});

describe('API as force_api', () => {
  const dataset = getDemoDataset();
  let cookie: string;
  let customer: number;
  let products: { code: number }[];

  const call = async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, who = cookie) => {
    const response = await api.app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { origin: TEST_ORIGIN, cookie: who, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
    return { status: response.statusCode, body: response.body === '' ? null : (JSON.parse(response.body) as Record<string, any>) }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  beforeAll(async () => {
    cookie = await loginCookie(api, DEMO_ACCOUNT_EMAILS.seller1, TEST_PASSWORD); // session + throttle + audit writes
    const own = dataset.customers.find((c) => c.sellerCode === 103 && c.active && !c.blocked && c.priceTableCode === 21);
    if (own === undefined) throw new Error('fixture lacks an orderable customer');
    customer = own.code;
    const list = await call('GET', `/products?customerCode=${customer}&pageSize=100&sellable=true&priceState=priced`);
    products = (list.body?.['items'] as { code: number }[]).slice(0, 3);
    expect(products.length).toBeGreaterThanOrEqual(2);
  });

  it('serves identity, mirror reads and readiness', async () => {
    expect((await call('GET', '/auth/session')).body?.['authenticated']).toBe(true);
    expect((await call('GET', '/customers?pageSize=5')).status).toBe(200);
    const adminCookie = await loginCookie(api, DEMO_ACCOUNT_EMAILS.admin, TEST_PASSWORD);
    const ready = await call('GET', '/ready', undefined, adminCookie);
    expect(ready.status).toBe(200);
    expect(JSON.stringify(ready.body)).not.toMatch(/not_ready/);
  });

  it('runs the order lifecycle: create, replace (line delete + insert), discard, submit stays disabled and audited', async () => {
    const body = (extra: object = {}) => ({
      clientRequestId: randomUUID(),
      customerCode: customer,
      negotiationTypeCode: 2,
      notes: null,
      expectedDataset: TEST_DATASET,
      items: [{ productCode: products[0]?.code, quantity: '2' }],
      ...extra,
    });
    const created = await call('POST', '/orders', body());
    expect(created.status).toBe(201);
    const id = created.body?.['id'] as string;
    const replaced = await call('PUT', `/orders/${id}`, { expectedVersion: 1, expectedDataset: TEST_DATASET, customerCode: customer, negotiationTypeCode: 3, notes: null, items: [{ productCode: products[1]?.code, quantity: '5' }] });
    expect(replaced.status, JSON.stringify(replaced.body)).toBe(200);
    expect(replaced.body?.['version']).toBe(2);
    expect((await call('GET', '/orders')).status).toBe(200);
    const submit = await call('POST', `/orders/${id}/submit`);
    expect(submit.status).toBe(409);
    expect(submit.body?.['code']).toBe('erp_submission_disabled');
    expect((await call('DELETE', `/orders/${id}`)).status).toBe(200);
  });

  it('runs the template lifecycle: create, replace, use, delete', async () => {
    const items = (code: number | undefined) => [{ productCode: code, quantity: '1' }];
    const created = await call('POST', `/customers/${customer}/order-templates`, { clientRequestId: randomUUID(), expectedDataset: TEST_DATASET, name: `Modelo ${randomUUID().slice(0, 6)}`, items: items(products[0]?.code) });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body?.['id'] as string;
    const replaced = await call('PUT', `/order-templates/${id}`, { expectedVersion: 1, expectedDataset: TEST_DATASET, name: `Modelo ${randomUUID().slice(0, 6)}`, items: items(products[1]?.code) });
    expect(replaced.status, JSON.stringify(replaced.body)).toBe(200);
    const used = await call('POST', `/order-templates/${id}/use`, { clientRequestId: randomUUID(), expectedDataset: TEST_DATASET });
    expect(used.status, JSON.stringify(used.body)).toBe(201);
    expect((await call('DELETE', `/order-templates/${id}`)).status).toBe(204);
  });

  it('serves the account CLI operations as force_api: password change, lockout clear, deactivate and reactivate, logout', async () => {
    const { accounts, repository } = createOperatorAccountService(apiDb, TEST_HASH_PARAMS);
    const account = await repository.findByEmail(DEMO_ACCOUNT_EMAILS.seller2);
    expect(account).not.toBeNull();
    const id = account?.id as string;
    const seller2 = await loginCookie(api, DEMO_ACCOUNT_EMAILS.seller2, TEST_PASSWORD);
    await accounts.setPassword(id, 'Another-Sturdy-Passphrase-77');
    await accounts.setStatus(id, 'disabled'); // revokes sessions (session UPDATE)
    expect((await call('GET', '/auth/session', undefined, seller2)).body?.['authenticated']).toBe(false);
    await accounts.setStatus(id, 'active');
    expect(await accounts.unlock(DEMO_ACCOUNT_EMAILS.seller2)).toBeTypeOf('boolean');
    expect((await call('POST', '/auth/logout', undefined, cookie)).status).toBe(204);
  });

  it('cannot reach what the role does not own, even through the API connection', async () => {
    const pool: pg.Pool = apiDb.pool;
    await expect(pool.query('create table t_api_ddl (id int)')).rejects.toMatchObject({ code: '42501' });
    await expect(pool.query(`update erp_customer set name = name`)).rejects.toMatchObject({ code: '42501' });
    await expect(pool.query('select 1 from pgboss.job limit 1')).rejects.toMatchObject({ code: '42501' });
  });
});
