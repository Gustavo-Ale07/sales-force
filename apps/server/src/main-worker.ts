import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createDb } from '@salesforce/db';
import { loadWorkerConfig } from './config/worker-env.js';
import { FilesystemObjectStore } from './media/object-store.js';
import { mirrorSchedulesFromSettings } from './sync/schedules.js';
import { createLogger } from './observability/logger.js';
import { NestPinoLogger } from './observability/nest-logger.js';
import { installProcessGuards, logPoolErrors, runMain } from './process.js';
import { WorkerRuntime } from './worker/runtime.js';
import { WorkerModule } from './worker/worker.module.js';

/**
 * Worker process entry point (STACK-2). The only process that reads Sankhya settings (STACK-3); it
 * builds the gateway from them (default: the synthetic fake) and fails fast on any problem. The
 * gateway goes only to the mirror sync service, which uses its read port. It never runs migrations or
 * installs queue tables (DATA-2) and performs no Sankhya write (SNK-4).
 */
runMain('worker', async () => {
  const { env, gateway, gatewayDescription } = loadWorkerConfig(process.env);
  const logger = createLogger({ level: env.LOG_LEVEL, service: 'worker' });
  const db = createDb(env.DATABASE_URL.reveal(), { max: env.DB_POOL_MAX, applicationName: 'salesforce-worker-app' });
  logPoolErrors(db, logger);

  const app = await NestFactory.createApplicationContext(
    WorkerModule.register(
      { logger, db },
      {
        databaseUrl: env.DATABASE_URL,
        heartbeatCron: env.HEARTBEAT_CRON,
        shutdownTimeoutMs: env.WORKER_SHUTDOWN_TIMEOUT_MS,
        health: { host: env.WORKER_HEALTH_HOST, port: env.WORKER_HEALTH_PORT },
        gatewayMode: gatewayDescription.mode,
      },
      { gateway, schedules: mirrorSchedulesFromSettings(env) },
      env.PRODUCT_MEDIA_SYNC_ENABLED && env.PRODUCT_MEDIA_DIR !== undefined
        ? {
            gateway,
            store: new FilesystemObjectStore(env.PRODUCT_MEDIA_DIR),
            cron: env.PRODUCT_MEDIA_SYNC_CRON,
            settings: {
              maxBytes: env.PRODUCT_MEDIA_MAX_BYTES,
              verifyObjects: env.PRODUCT_MEDIA_VERIFY_OBJECTS,
              pageSize: 100,
              concurrency: env.PRODUCT_MEDIA_SYNC_CONCURRENCY,
              allowFakeGateway: env.PRODUCT_MEDIA_ALLOW_FAKE_GATEWAY,
              sourceFailureLimit: env.PRODUCT_MEDIA_SOURCE_FAILURE_LIMIT,
            },
          }
        : undefined,
    ),
    { logger: new NestPinoLogger(logger), abortOnError: false },
  );
  const runtime = app.get(WorkerRuntime);

  installProcessGuards(logger, async () => {
    await runtime.stop();
    await app.close();
    await db.close();
  });
  await runtime.start();
  logger.info(
    { gatewayMode: gatewayDescription.mode, environmentKind: gatewayDescription.environmentKind, nodeEnv: env.NODE_ENV },
    'worker ready',
  );
});
