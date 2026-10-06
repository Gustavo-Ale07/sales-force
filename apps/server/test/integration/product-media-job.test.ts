import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { productMedia } from '@salesforce/db';
import { FakeGateway, getDemoDataset, syntheticProductImage } from '@salesforce/sankhya';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FilesystemObjectStore } from '../../src/media/object-store.js';
import { ProductMediaSyncService } from '../../src/media/product-media-sync.service.js';
import { createLogger } from '../../src/observability/logger.js';
import { FakeThumbnailRenderer } from '../helpers/fake-thumbnail-renderer.js';
import { installQueues } from '../../src/worker/queue-installer.js';
import { QUEUE_NAMES, QUEUE_REGISTRY } from '../../src/worker/queues.js';
import { WorkerRuntime } from '../../src/worker/runtime.js';
import { closeAllThenStop, createMigratedDatabase, startPostgres, type MigratedDatabase, type TestPostgres } from '../helpers/postgres.js';

const CODE = (() => {
  const first = getDemoDataset().products.find((p) => p.active);
  if (first === undefined) throw new Error('fixture needs an active product');
  return first.code;
})();

let postgres: TestPostgres;
const databases: MigratedDatabase[] = [];
const roots: string[] = [];

beforeAll(async () => {
  postgres = await startPostgres();
});
afterAll(async () => {
  await closeAllThenStop(
    databases.map((database) => () => database.handle.close()),
    postgres,
  );
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** The real service, plus a promise that settles when the job handler's run finishes (no polling, no sleeps). */
class ObservedService extends ProductMediaSyncService {
  readonly finished: Promise<void>;
  #settle: (error?: unknown) => void = () => undefined;

  constructor(deps: ConstructorParameters<typeof ProductMediaSyncService>[0]) {
    super(deps);
    this.finished = new Promise<void>((resolve, reject) => {
      this.#settle = (error) => (error === undefined ? resolve() : reject(error));
    });
  }

  override async run(...args: Parameters<ProductMediaSyncService['run']>): ReturnType<ProductMediaSyncService['run']> {
    try {
      const result = await super.run(...args);
      this.#settle();
      return result;
    } catch (error) {
      this.#settle(error);
      throw error;
    }
  }
}

async function prepared(): Promise<MigratedDatabase> {
  const database = await createMigratedDatabase(postgres);
  databases.push(database);
  await installQueues(database.secret, { specs: QUEUE_REGISTRY });
  return database;
}

function runtimeFor(database: MigratedDatabase, media?: { service: ProductMediaSyncService; cron: string }): WorkerRuntime {
  return new WorkerRuntime({
    logger: createLogger({ level: 'silent', service: 'worker' }),
    db: database.handle,
    now: () => new Date(),
    ...(media === undefined ? {} : { media }),
    options: {
      databaseUrl: database.secret,
      heartbeatCron: '*/5 * * * *',
      shutdownTimeoutMs: 10_000,
      health: null,
      gatewayMode: 'fake',
      pollingIntervalSeconds: 0.5,
    },
  });
}

describe('media.products job', () => {
  it('is a registered queue but has no handler and no schedule while the feature is disabled', async () => {
    expect(QUEUE_REGISTRY.map((spec) => spec.name)).toContain(QUEUE_NAMES.mediaProducts);
    const database = await prepared();
    const runtime = runtimeFor(database);
    await runtime.start();
    try {
      const schedules = await runtime.boss.getSchedules();
      expect(schedules.some((schedule) => schedule.name === QUEUE_NAMES.mediaProducts)).toBe(false);
    } finally {
      await runtime.stop();
    }
  });

  it('when enabled, schedules the queue and a job stores the photo; disabling later drops the schedule', async () => {
    const database = await prepared();
    const root = mkdtempSync(join(tmpdir(), 'sf-media-job-'));
    roots.push(root);
    const images = new Map([[CODE, syntheticProductImage('png', 2000, 7)]]);
    const service = new ObservedService({
      db: database.handle,
      gateway: new FakeGateway({ media: { images } }),
      store: new FilesystemObjectStore(root),
      renderer: new FakeThumbnailRenderer(),
      logger: createLogger({ level: 'silent', service: 'worker' }),
      now: () => new Date(),
      settings: { maxBytes: 1024 * 1024, verifyObjects: true, pageSize: 100, concurrency: 2, allowFakeGateway: true, sourceFailureLimit: 3 },
    });

    const enabled = runtimeFor(database, { service, cron: '15 4 * * *' });
    await enabled.start();
    try {
      const schedules = await enabled.boss.getSchedules();
      expect(schedules.find((schedule) => schedule.name === QUEUE_NAMES.mediaProducts)?.cron).toBe('15 4 * * *');
      await enabled.boss.send(QUEUE_NAMES.mediaProducts, {});
      await service.finished; // the handler ran the real service to completion (the vitest timeout bounds a hang)
      const [row] = await database.handle.db.select().from(productMedia);
      expect(row).toMatchObject({ productCode: CODE, status: 'stored', contentType: 'image/png', thumbnailContentType: 'image/webp' });
      expect(row?.thumbnailStorageKey).toMatch(/^product-thumbnails\/\d+\/[0-9a-f]{64}$/);
    } finally {
      await enabled.stop();
    }

    const disabled = runtimeFor(database);
    await disabled.start();
    try {
      const schedules = await disabled.boss.getSchedules();
      expect(schedules.some((schedule) => schedule.name === QUEUE_NAMES.mediaProducts)).toBe(false);
    } finally {
      await disabled.stop();
    }
  });
});
