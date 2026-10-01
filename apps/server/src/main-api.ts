import 'reflect-metadata';
import { createDb } from '@salesforce/db';
import { createApiApp } from './api/create-app.js';
import { parseApiEnv } from './config/api-env.js';
import { authConfigFromEnv } from './iam/auth-config.js';
import { createLogger } from './observability/logger.js';
import { demoAccountsWarning } from './platform/demo-accounts-check.js';
import { applyPoolLimits } from './platform/pool-limits.js';
import { installProcessGuards, logPoolErrors, runMain } from './process.js';

/**
 * API process entry point (STACK-2). It reads the API environment only (never Sankhya settings),
 * does not run migrations (DATA-2; `/ready` reports `not_ready` while they are behind) and does not
 * touch the queue or the ERP. `NODE_ENV` has no default: a missing value stops the process.
 */
runMain('api', async () => {
  const env = parseApiEnv(process.env);
  const logger = createLogger({ level: env.LOG_LEVEL, service: 'api' });
  const db = createDb(env.DATABASE_URL.reveal(), { max: env.DB_POOL_MAX, applicationName: 'salesforce-api' });
  // Bounded waits: no request queues forever for a connection, no statement runs unbounded (A7).
  applyPoolLimits(db.pool, { connectionTimeoutMs: env.DB_CONNECTION_TIMEOUT_MS, statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS });
  logPoolErrors(db, logger);

  const app = await createApiApp({
    logger,
    db,
    auth: authConfigFromEnv(env),
    dataset: env.dataset,
    readinessCacheTtlMs: env.READINESS_CACHE_TTL_MS,
    trustProxy: env.TRUST_PROXY,
    limits: {
      requestTimeoutMs: env.REQUEST_TIMEOUT_MS,
      keepAliveTimeoutMs: env.KEEP_ALIVE_TIMEOUT_MS,
      connectionTimeoutMs: env.CONNECTION_TIMEOUT_MS,
    },
  });
  installProcessGuards(logger, async () => {
    await app.close();
    await db.close();
  });
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  logger.info({ host: env.API_HOST, port: env.API_PORT, nodeEnv: env.NODE_ENV, trustProxy: env.TRUST_PROXY !== false }, 'api listening');
  // Startup warning only (F12): demo accounts carry a known development password. Counts, never e-mails.
  const demo = await demoAccountsWarning(db.db, env.NODE_ENV);
  if (demo !== null && demo.count > 0) {
    logger.warn({ demoAccounts: demo.count }, 'production database contains demo accounts (*.demo.salesforce.local): disable or remove them before real use');
  }
});
