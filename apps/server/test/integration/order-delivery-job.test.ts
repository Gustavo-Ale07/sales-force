import { FakeGateway } from '@salesforce/sankhya';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../src/iam/audit.service.js';
import { OrderDeliveryService } from '../../src/integration/order-delivery.service.js';
import { OrderErpStatusService } from '../../src/integration/order-erp-status.service.js';
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
    settings: { mode: 'dry_run', originField: 'AD_TESTE_ORIGEM', target: { environment: 'sandbox' } },
    audit: new AuditService(database.handle.db, now),
    logger,
    now,
  });
  return new WorkerRuntime({
    logger,
    db: database.handle,
    now,
    ...(withDelivery
      ? { orderDelivery: { service, status: new OrderErpStatusService({ db: database.handle, gateway: new FakeGateway(), logger, now }) } }
      : {}),
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

describe('order delivery short trigger (number and stage shortly after Confirmar)', () => {
  it('sweeps on its own short interval, reads the stage only after a sweep that delivered something, and stops with the worker', async () => {
    const database = await prepared();
    const logger = createLogger({ level: 'silent', service: 'worker' });
    const calls = { sweeps: 0, stages: 0 };
    let delivered = 0;
    const service = { runDue: async () => { calls.sweeps += 1; const processed = delivered; delivered = 0; return { processed, recovered: 0 }; }, purgeDryRuns: async () => 0 };
    const status = { runStageOnce: async () => { calls.stages += 1; return { checked: 0, updated: 0 }; }, runOnce: async () => ({ checked: 0, updated: 0 }), runReleaseOnce: async () => ({ checked: 0, updated: 0 }) };
    const runtime = new WorkerRuntime({
      logger,
      db: database.handle,
      now: () => new Date(),
      orderDelivery: { service: service as never, status: status as never, triggerMs: 40 },
      options: { databaseUrl: database.secret, heartbeatCron: '*/5 * * * *', shutdownTimeoutMs: 10_000, health: null, gatewayMode: 'fake', pollingIntervalSeconds: 0.5 },
    });
    await runtime.start();
    try {
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(calls.sweeps).toBeGreaterThanOrEqual(3);
      expect(calls.stages).toBe(0);
      delivered = 1;
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(calls.stages).toBe(1);
    } finally {
      await runtime.stop();
    }
    const after = calls.sweeps;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(calls.sweeps).toBe(after);
  });
});

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
      expect(names).not.toContain(QUEUE_NAMES.syncErpOrderStatus);
    } finally {
      await off.stop();
    }

    const on = runtimeFor(database, true);
    await on.start();
    try {
      const schedules = await on.boss.getSchedules();
      expect(schedules.find((s) => s.name === QUEUE_NAMES.integrationOrderDeliver)?.cron).toBe(ORDER_DELIVERY_CRON);
      expect(schedules.find((s) => s.name === QUEUE_NAMES.integrationOrderDryRunPurge)?.cron).toBe(ORDER_DRY_RUN_PURGE_CRON);
      // RT-1: the status runs in the in-process cycle, no longer as a cron.
      expect(schedules.find((s) => s.name === QUEUE_NAMES.syncErpOrderStatus)).toBeUndefined();
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
