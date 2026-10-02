import {
  FakeGateway,
  getDemoDataset,
  SankhyaGatewayError,
  type DemoDataset,
  type GatewayDescription,
  type ReadEntity,
  type ReadOptions,
} from '@salesforce/sankhya';
import { syncState } from '@salesforce/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/observability/logger.js';
import { summarizeIntegration } from '../../src/platform/integration-summary.js';
import { recordWorkerHeartbeat } from '../../src/platform/worker-heartbeat.js';
import { MIRROR_ENTITIES, mirrorQueueName, type MirrorEntity } from '../../src/sync/mirror-entities.js';
import { MirrorSyncService } from '../../src/sync/mirror-sync.service.js';
import { mirrorSchedulesFromSettings } from '../../src/sync/schedules.js';
import { installQueues } from '../../src/worker/queue-installer.js';
import { QUEUE_NAMES, QUEUE_REGISTRY, type QueueSpec } from '../../src/worker/queues.js';
import { WorkerRuntime } from '../../src/worker/runtime.js';
import { captureLogs, createMigratedDatabase, startPostgres, type MigratedDatabase, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

const TABLES: Record<MirrorEntity, string> = {
  sellers: 'erp_seller',
  customers: 'erp_customer',
  products: 'erp_product',
  priceTables: 'erp_price_table',
  priceTableVersions: 'erp_price_table_version',
  listPrices: 'erp_list_price',
};

let postgres: TestPostgres;
const databases: MigratedDatabase[] = [];

beforeAll(async () => {
  postgres = await startPostgres();
});

afterAll(async () => {
  await closeAllThenStop(
    databases.map((database) => () => database.handle.close()),
    postgres,
  );
});

async function migrated(): Promise<MigratedDatabase> {
  const database = await createMigratedDatabase(postgres);
  databases.push(database);
  return database;
}

async function count(database: MigratedDatabase, table: string, where = 'true'): Promise<number> {
  const { rows } = await database.handle.pool.query<{ n: number }>(`select count(*)::int as n from ${table} where ${where}`);
  return rows[0]?.n ?? 0;
}

async function stateOf(database: MigratedDatabase, entity: string) {
  const [row] = await database.handle.db.select().from(syncState).where(eq(syncState.entity, entity));
  return row;
}

function serviceFor(database: MigratedDatabase, gateway: FakeGateway, now: () => Date = () => new Date()): MirrorSyncService {
  return new MirrorSyncService({
    db: database.handle,
    gateway,
    logger: createLogger({ level: 'silent', service: 'worker' }),
    now,
  });
}

/** A modifiable copy of the synthetic dataset (the shared one is frozen). */
function datasetCopy(): { -readonly [K in keyof DemoDataset]: DemoDataset[K][number][] } {
  const source = getDemoDataset();
  return {
    sellers: [...source.sellers],
    sellerManagerLinks: [...source.sellerManagerLinks],
    customers: [...source.customers],
    productGroups: [...source.productGroups],
    products: [...source.products],
    priceTables: [...source.priceTables],
    priceTableVersions: [...source.priceTableVersions],
    listPrices: [...source.listPrices],
  };
}

/** Fake gateway with hooks: a failing read (by call), a gate that holds a read open, a capability gap. */
class ScriptedGateway extends FakeGateway {
  readonly calls: Partial<Record<ReadEntity, number>> = {};
  failWith: Partial<Record<ReadEntity, () => SankhyaGatewayError | undefined>> = {};
  gate: { entity: ReadEntity; entered: () => void; release: Promise<void> } | null = null;
  unsupported: ReadEntity[] = [];
  liveMode = false;

  override describe(): GatewayDescription {
    const base = super.describe();
    if (this.liveMode) return { ...base, mode: 'live' };
    const reads = { ...base.capabilities.reads };
    for (const entity of this.unsupported) reads[entity] = 'not_implemented';
    return { ...base, capabilities: { ...base.capabilities, reads } };
  }

  #wrap<T>(entity: ReadEntity, inner: AsyncIterable<readonly T[]>): AsyncIterable<readonly T[]> {
    return {
      [Symbol.asyncIterator]: async function* (this: ScriptedGateway) {
        this.calls[entity] = (this.calls[entity] ?? 0) + 1;
        const error = this.failWith[entity]?.();
        if (error !== undefined) throw error;
        if (this.gate?.entity === entity) {
          this.gate.entered();
          await this.gate.release;
        }
        yield* inner;
      }.bind(this),
    };
  }

  override readSellers(options?: ReadOptions) {
    return this.#wrap('sellers', super.readSellers(options));
  }
  override readCustomers(options?: ReadOptions) {
    return this.#wrap('customers', super.readCustomers(options));
  }
}

describe('mirror sync (RF-SNK-1/2/8 subset, WP 0.8)', () => {
  it('populates every mirror table from the gateway and records sync_state', async () => {
    const database = await migrated();
    const source = getDemoDataset();
    const service = serviceFor(database, new FakeGateway({ batchSize: 7 }));

    const { results, failures } = await service.runAll();
    expect(failures).toEqual([]);
    expect(results.map((result) => result.outcome)).toEqual(MIRROR_ENTITIES.map(() => 'completed'));

    expect(await count(database, TABLES.sellers)).toBe(source.sellers.length);
    expect(await count(database, TABLES.customers)).toBe(source.customers.length);
    expect(await count(database, TABLES.products)).toBe(source.products.length);
    expect(await count(database, TABLES.priceTables)).toBe(source.priceTables.length);
    expect(await count(database, TABLES.priceTableVersions)).toBe(source.priceTableVersions.length);
    expect(await count(database, TABLES.listPrices)).toBe(source.listPrices.length);
    for (const table of Object.values(TABLES)) expect(await count(database, table, 'deleted_at is not null')).toBe(0);

    for (const entity of MIRROR_ENTITIES) {
      const state = await stateOf(database, entity);
      expect(state?.status).toBe('succeeded');
      expect(state?.lastSuccessAt).toBeInstanceOf(Date);
      expect(state?.lastErrorClass).toBeNull();
      expect(state?.rowCount).toBe(await count(database, TABLES[entity]));
    }

    // Group names are denormalized from the product groups; prices keep the exact decimal text.
    expect(await count(database, TABLES.products, 'group_code is not null and group_name is null')).toBe(0);
    const price = source.listPrices[0];
    const { rows } = await database.handle.pool.query<{ unit_price: string }>(
      `select unit_price from erp_list_price where version_id = $1 and product_code = $2`,
      [price?.versionId, price?.productCode],
    );
    expect(Number(rows[0]?.unit_price)).toBe(Number(price?.unitPrice));
  });

  it('is a no-op on the second run: everything unchanged, no row rewritten', async () => {
    const database = await migrated();
    const service = serviceFor(database, new FakeGateway({ batchSize: 50 }));
    await service.runAll();
    const versions = async () =>
      (await database.handle.pool.query<{ code: number; version: string }>(`select code, xmin::text as version from erp_customer order by code`)).rows;
    const before = await versions();

    const second = await service.runAll();
    expect(second.failures).toEqual([]);
    for (const result of second.results) {
      expect(result.stats).toMatchObject({ created: 0, updated: 0, reactivated: 0, deactivated: 0 });
      expect(result.stats?.unchanged).toBe(result.stats?.read);
    }
    // No row version changed: nothing was rewritten.
    expect(await versions()).toEqual(before);
  });

  it('updates a changed source row, soft-deactivates a removed one and reactivates it when it returns', async () => {
    const database = await migrated();
    const dataset = datasetCopy();
    const service = () => serviceFor(database, new FakeGateway({ batchSize: 10, dataset: dataset as DemoDataset }));
    await service().run('customers');

    const changed = dataset.customers[0]!;
    const removed = dataset.customers[1]!;
    dataset.customers[0] = { ...changed, name: 'Nome alterado (sintético)' };
    dataset.customers.splice(1, 1);

    const run = await service().run('customers');
    expect(run.stats).toMatchObject({ updated: 1, deactivated: 1, created: 0 });
    const { rows } = await database.handle.pool.query<{ name: string }>(`select name from erp_customer where code = $1`, [changed.code]);
    expect(rows[0]?.name).toBe('Nome alterado (sintético)');
    // Soft deactivation: the row is still there, never hard-deleted.
    expect(await count(database, TABLES.customers, `code = ${removed.code} and deleted_at is not null`)).toBe(1);
    expect((await stateOf(database, 'customers'))?.rowCount).toBe(dataset.customers.length);

    dataset.customers.push(removed);
    const back = await service().run('customers');
    expect(back.stats).toMatchObject({ reactivated: 1, deactivated: 0 });
    expect(await count(database, TABLES.customers, 'deleted_at is not null')).toBe(0);
  });

  it('never deactivates on a partial read, and refuses an empty snapshot over a populated mirror', async () => {
    const database = await migrated();
    const dataset = datasetCopy();
    const gateway = new FakeGateway({ batchSize: 5, dataset: dataset as DemoDataset });
    await serviceFor(database, gateway).run('sellers');
    const total = dataset.sellers.length;

    // Failure after the first batch: the read is partial, so nothing may be deactivated.
    const partial = new FakeGateway({
      batchSize: 2,
      dataset: dataset as DemoDataset,
      faults: [{ entity: 'sellers', afterBatches: 1, error: new SankhyaGatewayError('unavailable', { code: 'x', message: 'down' }) }],
    });
    await expect(serviceFor(database, partial).run('sellers')).rejects.toBeInstanceOf(SankhyaGatewayError);
    expect(await count(database, TABLES.sellers, 'deleted_at is not null')).toBe(0);
    expect(await count(database, TABLES.sellers)).toBe(total);

    // Empty snapshot: fails closed.
    dataset.sellers.length = 0;
    await expect(serviceFor(database, gateway).run('sellers')).rejects.toMatchObject({ code: 'empty_snapshot' });
    expect(await count(database, TABLES.sellers, 'deleted_at is not null')).toBe(0);
    const state = await stateOf(database, 'sellers');
    expect(state?.status).toBe('failed');
    expect(state?.lastErrorClass).toBe('validation');
    // The last good run is still described.
    expect(state?.rowCount).toBe(total);
    expect(state?.lastSuccessAt).toBeInstanceOf(Date);
  });

  it('records a transient fault as failed with its class (no secrets), keeps the last success, and a later run clears it', async () => {
    const database = await migrated();
    const gateway = new ScriptedGateway({ batchSize: 10 });
    const service = serviceFor(database, gateway);
    await service.run('sellers');
    const good = await stateOf(database, 'sellers');

    gateway.failWith.sellers = () =>
      new SankhyaGatewayError('unavailable', { code: 'erp_down', message: 'ERP unreachable' });
    await expect(service.run('sellers')).rejects.toMatchObject({ kind: 'unavailable', retryable: true });
    const failed = await stateOf(database, 'sellers');
    expect(failed?.status).toBe('failed');
    expect(failed?.lastErrorClass).toBe('unavailable');
    expect(failed?.lastErrorMessage).toBe('erp_down: ERP unreachable');
    expect(failed?.lastSuccessAt?.getTime()).toBe(good?.lastSuccessAt?.getTime());
    expect(failed?.rowCount).toBe(good?.rowCount);

    // An unexpected (non-gateway) error may echo secrets or data: only its class and code are stored.
    gateway.failWith.sellers = () => {
      throw Object.assign(new Error('connect failed password=abc123SECRET'), { code: 'XX000' });
    };
    await expect(service.run('sellers')).rejects.toThrow();
    const unexpected = await stateOf(database, 'sellers');
    expect(unexpected?.lastErrorClass).toBe('unclassified');
    expect(unexpected?.lastErrorMessage).not.toContain('abc123SECRET');

    delete gateway.failWith.sellers;
    const recovered = await service.run('sellers');
    expect(recovered.outcome).toBe('completed');
    const ok = await stateOf(database, 'sellers');
    expect(ok?.status).toBe('succeeded');
    expect(ok?.lastErrorClass).toBeNull();
    expect(ok?.lastErrorMessage).toBeNull();
  });

  it('records an entity the gateway cannot read yet as failed/not_implemented, without failing the others', async () => {
    const database = await migrated();
    const gateway = new ScriptedGateway({ batchSize: 50 });
    gateway.unsupported = ['listPrices', 'productGroups'];
    const { results, failures } = await serviceFor(database, gateway).runAll();
    expect(failures).toEqual([]);
    expect(results.find((result) => result.entity === 'listPrices')?.outcome).toBe('unsupported');
    expect(results.find((result) => result.entity === 'products')?.outcome).toBe('completed');
    expect(await count(database, TABLES.listPrices)).toBe(0);
    // Products are mirrored; group names are not available yet, so they stay NULL (never invented).
    expect(await count(database, TABLES.products)).toBe(getDemoDataset().products.length);
    expect(await count(database, TABLES.products, 'group_name is not null')).toBe(0);

    const state = await stateOf(database, 'listPrices');
    expect(state?.status).toBe('failed');
    expect(state?.lastErrorClass).toBe('permanent');
    expect(state?.lastErrorMessage).toMatch(/^not_implemented/);
  });

  it('fails closed against a live ERP when the read scope is absent or has no price-table list (never an unscoped read)', async () => {
    const database = await migrated();
    const gateway = new ScriptedGateway({ batchSize: 50 });
    gateway.liveMode = true;
    const logger = createLogger({ level: 'silent', service: 'worker' });
    const noScope = new MirrorSyncService({ db: database.handle, gateway, logger, now: () => new Date() });
    const noTables = new MirrorSyncService({
      db: database.handle,
      gateway,
      logger,
      now: () => new Date(),
      readScope: async () => ({ products: { usageValues: ['V'], activeOnly: true } }),
    });
    for (const service of [noScope, noTables]) {
      const { failures } = await service.runAll(['priceTables', 'listPrices']);
      expect(failures).toHaveLength(2);
      expect(failures.every((f) => f.failure.errorClass === 'unclassified')).toBe(true); // not retried automatically
    }
    expect(gateway.calls.priceTables ?? 0).toBe(0);
    expect(gateway.calls.listPrices ?? 0).toBe(0);
    expect(await count(database, TABLES.priceTables)).toBe(0);
    expect(await count(database, TABLES.listPrices)).toBe(0);
  });

  it('does not double-write when two runs of the same entity overlap: the second skips', async () => {
    const database = await migrated();
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => (entered = resolve));
    let release!: () => void;
    const releasePromise = new Promise<void>((resolve) => (release = resolve));

    const blocking = new ScriptedGateway({ batchSize: 10 });
    blocking.gate = { entity: 'customers', entered, release: releasePromise };
    const first = serviceFor(database, blocking).run('customers');
    await enteredPromise;

    // Another "process" (own service, own session) while the first one holds the lock.
    const second = await serviceFor(database, new ScriptedGateway({ batchSize: 10 })).run('customers');
    expect(second.outcome).toBe('skipped_locked');
    expect(await count(database, TABLES.customers)).toBe(0);
    // A different entity is not blocked by the lock.
    expect((await serviceFor(database, new FakeGateway()).run('sellers')).outcome).toBe('completed');

    release();
    const done = await first;
    expect(done.outcome).toBe('completed');
    expect(done.stats?.created).toBe(getDemoDataset().customers.length);
    expect(await count(database, TABLES.customers)).toBe(getDemoDataset().customers.length);

    // The lock was released: a later run works.
    expect((await serviceFor(database, new FakeGateway()).run('customers')).outcome).toBe('completed');
  });

  it('feeds the /ready integration summary: a failing entity makes it degraded, recovery makes it ok', async () => {
    const database = await migrated();
    const now = new Date();
    await recordWorkerHeartbeat(database.handle.db, { gatewayMode: 'fake', startedAt: now.toISOString() }, now);
    const gateway = new ScriptedGateway({ batchSize: 50 });
    const service = serviceFor(database, gateway, () => now);
    await service.runAll();
    const summarize = async () => summarizeIntegration(await database.handle.db.select().from(syncState), now);

    const healthy = await summarize();
    expect(healthy.state).toBe('ok');
    expect(healthy.failingEntities).toEqual([]);
    expect(healthy.lastSuccessAt).toBe(now.toISOString());

    gateway.failWith.customers = () => new SankhyaGatewayError('auth', { code: 'auth_failed', message: 'credentials refused' });
    await expect(service.run('customers')).rejects.toMatchObject({ kind: 'auth' });
    const degraded = await summarize();
    expect(degraded.state).toBe('degraded');
    expect(degraded.failingEntities).toEqual(['customers']);

    delete gateway.failWith.customers;
    await service.run('customers');
    expect((await summarize()).state).toBe('ok');
  });
});

describe('mirror jobs through pg-boss (retry / dead-letter)', () => {
  // Same queues as production, with a 1 s retry delay so the test does not wait 30 s.
  const FAST_QUEUES: readonly QueueSpec[] = QUEUE_REGISTRY.map((spec) => {
    if (!spec.name.startsWith('sync.mirror.')) return spec;
    const { retryDelayMax: _unused, ...options } = spec.options;
    return { name: spec.name, options: { ...options, retryLimit: 2, retryDelay: 1, retryBackoff: false } };
  });

  async function until<T>(read: () => Promise<T | undefined>, what: string, timeoutMs = 30_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await read();
      if (value !== undefined) return value;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  it('retries a transient failure, dead-letters a permanent one, and schedules the configured entities', async () => {
    const database = await migrated();
    await installQueues(database.secret, { specs: FAST_QUEUES });

    const gateway = new ScriptedGateway({ batchSize: 50 });
    let sellerAttempts = 0;
    gateway.failWith.sellers = () => {
      sellerAttempts += 1;
      return sellerAttempts === 1 ? new SankhyaGatewayError('temporary', { code: 'blip', message: 'temporary blip' }) : undefined;
    };
    gateway.failWith.customers = () => new SankhyaGatewayError('validation', { code: 'rejected', message: 'business rule rejected the read' });

    const capture = captureLogs();
    const logger = createLogger({ level: 'info', service: 'worker', destination: capture.stream });
    const service = new MirrorSyncService({ db: database.handle, gateway, logger, now: () => new Date() });
    const schedules = mirrorSchedulesFromSettings({
      SYNC_MIRROR_ENABLED: true,
      SYNC_CRON_SELLERS: '0 3 * * *',
      SYNC_CRON_CUSTOMERS: '0 3 * * *',
      SYNC_CRON_PRODUCTS: '0 3 * * *',
      SYNC_CRON_PRICES: '0 3 * * *',
    });
    const runtime = new WorkerRuntime({
      logger,
      db: database.handle,
      now: () => new Date(),
      queues: FAST_QUEUES,
      mirror: { service, schedules },
      options: {
        databaseUrl: database.secret,
        heartbeatCron: '*/5 * * * *',
        shutdownTimeoutMs: 10_000,
        health: null,
        gatewayMode: 'fake',
        pollingIntervalSeconds: 0.5,
      },
    });
    await runtime.start();
    try {
      const registered = await runtime.boss.getSchedules();
      for (const entity of MIRROR_ENTITIES) {
        expect(registered.find((schedule) => schedule.name === mirrorQueueName(entity))?.cron).toBe('0 3 * * *');
      }

      await runtime.boss.send(mirrorQueueName('sellers'), {});
      await until(async () => ((await stateOf(database, 'sellers'))?.status === 'succeeded' ? true : undefined), 'sellers to succeed after a retry');
      expect(sellerAttempts).toBe(2);
      expect(await count(database, TABLES.sellers)).toBe(getDemoDataset().sellers.length);

      const deadLettered = async () => {
        const { rows } = await database.handle.pool.query<{ n: number }>(`select count(*)::int as n from pgboss.job where name = $1`, [
          QUEUE_NAMES.deadLetter,
        ]);
        return rows[0]?.n ?? 0;
      };
      expect(await deadLettered()).toBe(0);

      await runtime.boss.send(mirrorQueueName('customers'), {});
      await until(async () => ((await deadLettered()) >= 1 ? true : undefined), 'the permanent failure in the dead-letter queue');
      // No retries for a permanent failure.
      expect(gateway.calls.customers).toBe(1);
      const customers = await stateOf(database, 'customers');
      expect(customers?.status).toBe('failed');
      expect(customers?.lastErrorClass).toBe('validation');
    } finally {
      await runtime.stop();
    }
  });
});
