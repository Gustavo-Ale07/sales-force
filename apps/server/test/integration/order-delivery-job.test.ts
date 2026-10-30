import { FakeGateway } from '@salesforce/sankhya';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../src/iam/audit.service.js';
import { OrderDeliveryService } from '../../src/integration/order-delivery.service.js';
import { createLogger } from '../../src/observability/logger.js';
import { installQueues } from '../../src/worker/queue-installer.js';
import {
  ORDER_DELIVERY_CRON,
  ORDER_DRY_RUN_PURGE_CRON,
  QUEUE_NAMES,
  QUEUE_REGISTRY,
} from '../../src/worker/queues.js';
import { WorkerRuntime } from '../../src/worker/runtime.js';
import {
  closeAllThenStop,
  createMigratedDatabase,
  startPostgres,
  type MigratedDatabase,
  type TestPostgres,
} from '../helpers/postgres.js';

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

async function prepared(): Promise<MigratedDatabase> {
  const database = await createMigratedDatabase(postgres);
  databases.push(database);
  await installQueues(database.secret, { specs: QUEUE_REGISTRY });
  return database;
}

function runtimeFor(database: MigratedDatabase, withDelivery: boolean): WorkerRuntime {
  const logger = createLogger({ level: 'silent', service: 'worker' });
  const now = () => new Date();
  const service = new OrderDeliveryService({
    db: database.handle,
    gateway: new FakeGateway(),
    settings: { mode: 'dry_run', originField: 'AD_TESTE_ORIGEM', unconfirmedTops: [1000], target: { environment: 'sandbox' } },
    audit: new AuditService(database.handle.db, now),
    logger,
    now,
  });
  return new WorkerRuntime({
    logger,
    db: database.handle,
    now,
    ...(withDelivery ? { orderDelivery: { service } } : {}),
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

describe('order delivery queues (SNK-7)', () => {
  it('are registered queues, scheduled only while order writing is enabled, dropped when disabled again', async () => {
    expect(QUEUE_REGISTRY.map((spec) => spec.name)).toEqual(
      expect.arrayContaining([QUEUE_NAMES.integrationOrderDeliver, QUEUE_NAMES.integrationOrderDryRunPurge]),
    );
    const database = await prepared();

    const off = runtimeFor(database, false);
    await off.start();
    try {
      const names = (await off.boss.getSchedules()).map((schedule) => schedule.name);
      expect(names).not.toContain(QUEUE_NAMES.integrationOrderDeliver);
      expect(names).not.toContain(QUEUE_NAMES.integrationOrderDryRunPurge);
    } finally {
      await off.stop();
    }

    const on = runtimeFor(database, true);
    await on.start();
    try {
      const schedules = await on.boss.getSchedules();
      expect(schedules.find((s) => s.name === QUEUE_NAMES.integrationOrderDeliver)?.cron).toBe(ORDER_DELIVERY_CRON);
      expect(schedules.find((s) => s.name === QUEUE_NAMES.integrationOrderDryRunPurge)?.cron).toBe(ORDER_DRY_RUN_PURGE_CRON);
    } finally {
      await on.stop();
    }

    const offAgain = runtimeFor(database, false);
    await offAgain.start();
    try {
      const names = (await offAgain.boss.getSchedules()).map((schedule) => schedule.name);
      expect(names).not.toContain(QUEUE_NAMES.integrationOrderDeliver);
    } finally {
      await offAgain.stop();
    }
  });
});
