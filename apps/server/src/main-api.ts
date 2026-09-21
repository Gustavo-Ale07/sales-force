import 'reflect-metadata';
import { createDb } from '@salesforce/db';
import { createApiApp } from './api/create-app.js';
import { parseApiEnv } from './config/api-env.js';
import { createLogger } from './observability/logger.js';
import { installProcessGuards, logPoolErrors, runMain } from './process.js';

/**
 * API process entry point (STACK-2). It reads the API environment only (never Sankhya settings),
 * does not run migrations (DATA-2; `/ready` reports `not_ready` while they are behind) and does not
 * touch the queue or the ERP.
 */
runMain('api', async () => {
  const env = parseApiEnv(process.env);
  const logger = createLogger({ level: env.LOG_LEVEL, service: 'api' });
  const db = createDb(env.DATABASE_URL.reveal(), { max: env.DB_POOL_MAX, applicationName: 'salesforce-api' });
  logPoolErrors(db, logger);

  const app = await createApiApp({ logger, db });
  installProcessGuards(logger, async () => {
    await app.close();
    await db.close();
  });
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  logger.info({ host: env.API_HOST, port: env.API_PORT, nodeEnv: env.NODE_ENV }, 'api listening');
});
