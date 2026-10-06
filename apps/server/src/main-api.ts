import 'reflect-metadata';
import { createDb } from '@salesforce/db';
import { createApiApp } from './api/create-app.js';
import { DEFAULT_PRODUCT_IMAGE_SETTINGS } from './catalog/product-image.js';
import { parseApiEnv } from './config/api-env.js';
import { FilesystemObjectStore } from './media/object-store.js';
import { checkProductMediaStore } from './media/store-check.js';
import { StoredProductImageSource } from './media/stored-product-image.source.js';
import { authConfigFromEnv } from './iam/auth-config.js';
import { createLogger } from './observability/logger.js';
import { enforceDemoAccountsPolicy } from './platform/demo-accounts-check.js';
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
  // Demo accounts carry a known development password: production refuses to boot with any unless
  // SF_ALLOW_DEMO_ACCOUNTS=true. Checked before the app is built or the port opened.
  try {
    await enforceDemoAccountsPolicy(db.db, env.NODE_ENV, process.env['SF_ALLOW_DEMO_ACCOUNTS'] === 'true', logger);
  } catch (error) {
    await db.close();
    throw error;
  }

  if (env.PRODUCT_MEDIA_DIR !== undefined) await checkProductMediaStore(db.db, env.PRODUCT_MEDIA_DIR, logger);

  const app = await createApiApp({
    logger,
    db,
    auth: authConfigFromEnv(env),
    dataset: env.dataset,
    readinessCacheTtlMs: env.READINESS_CACHE_TTL_MS,
    trustProxy: env.TRUST_PROXY,
    // Product photos: read-only view of what the worker stored (never the ERP). Unset = no product has an image.
    ...(env.PRODUCT_MEDIA_DIR === undefined
      ? {}
      : {
          productImageSource: new StoredProductImageSource(db.db, new FilesystemObjectStore(env.PRODUCT_MEDIA_DIR), {
            thumbMaxBytes: env.PRODUCT_MEDIA_THUMB_MAX_BYTES,
            maxBytes: env.PRODUCT_MEDIA_MAX_BYTES,
          }),
          productImageSettings: {
            ...DEFAULT_PRODUCT_IMAGE_SETTINGS,
            maxBytes: { thumb: env.PRODUCT_MEDIA_THUMB_MAX_BYTES, full: env.PRODUCT_MEDIA_MAX_BYTES },
          },
        }),
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
});
