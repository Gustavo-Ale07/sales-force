import {
  createGateway,
  GatewayConfigError,
  type GatewayDescription,
  type SankhyaGateway,
} from '@salesforce/sankhya';
import { z } from 'zod';
import { DEFAULT_MIRROR_CRONS } from '../sync/schedules.js';
import { validateInstallationConfiguration } from '../configuration/validate.js';
import { mediaDirField, mediaDirProblems, mediaMaxBytesField } from './media-env.js';
import {
  databaseUrlField,
  EnvValidationError,
  integerField,
  logLevelField,
  nodeEnvField,
  isLoopbackHost,
  parseEnv,
  portField,
  withoutEmptyValues,
  type EnvSource,
} from './env.js';

/**
 * Worker process environment (STACK-2/STACK-3). The worker is the only process that reads
 * `SANKHYA_*` (and `SF_CONFIG_FILE`): those are parsed and validated by `createGateway` from
 * `@salesforce/sankhya`, which reports its own problems by variable name only.
 */
const cronField = (defaultValue: string) =>
  z
    .string()
    .regex(/^\S+(\s+\S+){4}$/,{ error: 'must be a 5-field cron expression, e.g. "*/10 * * * *".' })
    .default(defaultValue);

export const WorkerEnvSchema = z.object({
  NODE_ENV: nodeEnvField,
  DATABASE_URL: databaseUrlField,
  LOG_LEVEL: logLevelField,
  DB_POOL_MAX: integerField({ min: 1, max: 100 }, 10),
  /** Loopback health endpoint used by the container HEALTHCHECK. Never bind it to a public address. */
  WORKER_HEALTH_HOST: z.string().min(1).default('127.0.0.1'),
  /** Explicit override that lets `WORKER_HEALTH_HOST` be a non-loopback address (`1`). Off by default. */
  WORKER_HEALTH_ALLOW_NON_LOOPBACK: z.string().optional(),
  WORKER_HEALTH_PORT: portField(3001),
  /** Cron expression (5 fields) of the `sync.heartbeat` scheduled job. */
  HEARTBEAT_CRON: z
    .string()
    .regex(/^\S+(\s+\S+){4}$/, { error: 'must be a 5-field cron expression, e.g. "* * * * *".' })
    .default('* * * * *'),
  /**
   * Mirror synchronization (WP 0.8). `false` = no scheduled mirror jobs (a manual `sync:once` still
   * works). The default crons are the PROPOSED frequencies of the spec (RF-SNK-1, spike §4) and stay
   * proposals until the Sankhya request limits are measured (S0.2). Default `true` for the fake
   * gateway only: with `SANKHYA_MODE=live` the variable is mandatory (checked in `loadWorkerConfig`).
   */
  SYNC_MIRROR_ENABLED: z
    .enum(['true', 'false'], { error: "must be 'true' or 'false'." })
    .default('true')
    .transform((value) => value === 'true'),
  SYNC_CRON_SELLERS: cronField(DEFAULT_MIRROR_CRONS.sellers),
  SYNC_CRON_CUSTOMERS: cronField(DEFAULT_MIRROR_CRONS.customers),
  SYNC_CRON_PRODUCTS: cronField(DEFAULT_MIRROR_CRONS.products),
  /** One schedule for the whole price model (price tables, versions, list prices). */
  SYNC_CRON_PRICES: cronField(DEFAULT_MIRROR_CRONS.prices),
  /** How long a graceful shutdown waits for running jobs before giving up. */
  WORKER_SHUTDOWN_TIMEOUT_MS: integerField({ min: 1000, max: 600_000 }, 30_000),

  /**
   * Product photo pipeline (`media.products`): reads photos from the ERP and stores them in the object
   * store. Off by default; `true` requires `PRODUCT_MEDIA_DIR`. The photo reads are as unmeasured as the
   * mirror ones (spike S0.2), so a real ERP never starts this by omission: the default is `false`.
   */
  PRODUCT_MEDIA_SYNC_ENABLED: z
    .enum(['true', 'false'], { error: "must be 'true' or 'false'." })
    .default('false')
    .transform((value) => value === 'true'),
  /** Absolute path of the persistent directory of the interim filesystem object store (a mounted volume). */
  PRODUCT_MEDIA_DIR: mediaDirField,
  PRODUCT_MEDIA_MAX_BYTES: mediaMaxBytesField,
  /** PROPOSED frequency (daily, 03:30): the photo read cost against the ERP is unmeasured. */
  PRODUCT_MEDIA_SYNC_CRON: cronField('30 3 * * *'),
  /** Images downloaded at once (each is a sequence of chunked ERP reads). */
  PRODUCT_MEDIA_SYNC_CONCURRENCY: integerField({ min: 1, max: 8 }, 2),
  /** Also confirm that the stored object still exists for unchanged products (repairs a lost object). */
  PRODUCT_MEDIA_VERIFY_OBJECTS: z
    .enum(['true', 'false'], { error: "must be 'true' or 'false'." })
    .default('true')
    .transform((value) => value === 'true'),
  /**
   * The photo pipeline stores only what a LIVE gateway returned. Storing the synthetic fake gateway's images
   * (development, tests, a staging running the fake) needs this explicit opt-in, and it is only honoured when the
   * worker already allows the fake gateway (checked below). Switching gateway mode needs a reset of the volume
   * and of `product_media` (docs/implementation/product-media.md).
   */
  PRODUCT_MEDIA_ALLOW_FAKE_GATEWAY: z
    .enum(['true', 'false'], { error: "must be 'true' or 'false'." })
    .default('false')
    .transform((value) => value === 'true'),
  /** Consecutive runs a product may fail with the ERP unavailable before it is parked as `source_unavailable`. */
  PRODUCT_MEDIA_SOURCE_FAILURE_LIMIT: integerField({ min: 1, max: 20 }, 3),
});

export type WorkerEnv = z.output<typeof WorkerEnvSchema>;

export interface WorkerConfig {
  readonly env: WorkerEnv;
  readonly gateway: SankhyaGateway;
  readonly gatewayDescription: GatewayDescription;
}

/**
 * Validates the worker environment and builds the gateway (default: the synthetic fake). Every
 * problem, from both the server variables and the gateway variables, is reported in one error.
 */
export function loadWorkerConfig(source: EnvSource): WorkerConfig {
  const problems: string[] = [];
  let env: WorkerEnv | undefined;
  try {
    env = parseEnv('Worker', WorkerEnvSchema, source, (parsed) => {
      const extra: string[] = [];
      if (parsed.WORKER_HEALTH_ALLOW_NON_LOOPBACK !== '1' && !isLoopbackHost(parsed.WORKER_HEALTH_HOST)) {
        extra.push(
          'WORKER_HEALTH_HOST: must be a loopback address (127.0.0.1, ::1, localhost); ' +
            'a non-loopback bind needs the explicit WORKER_HEALTH_ALLOW_NON_LOOPBACK=1.',
        );
      }
      // Scheduled mirror jobs against a REAL Sankhya are never on by default: the request limits are
      // still unmeasured (spike S0.2). Live mode must say `SYNC_MIRROR_ENABLED=true|false` explicitly.
      const values = withoutEmptyValues(source);
      if (parsed.NODE_ENV === 'production') {
        // Production never falls back to the synthetic gateway by omission (F7).
        const mode = values['SANKHYA_MODE']?.toLowerCase();
        if (mode === undefined) {
          extra.push("SANKHYA_MODE: is required when NODE_ENV=production ('live', or 'fake' with the explicit ALLOW_FAKE_GATEWAY=1); there is no silent default.");
        } else if (mode === 'fake' && values['ALLOW_FAKE_GATEWAY'] !== '1') {
          extra.push('SANKHYA_MODE: the synthetic fake gateway is refused when NODE_ENV=production unless ALLOW_FAKE_GATEWAY=1 is set explicitly.');
        }
      }
      if (values['SANKHYA_MODE']?.toLowerCase() === 'live' && values['SYNC_MIRROR_ENABLED'] === undefined) {
        extra.push(
          'SYNC_MIRROR_ENABLED: must be set explicitly (true or false) when SANKHYA_MODE=live; ' +
            'scheduled mirror jobs never start against a real Sankhya by default (spike S0.2 open).',
        );
      }
      extra.push(...mediaDirProblems(parsed.PRODUCT_MEDIA_DIR));
      if (parsed.PRODUCT_MEDIA_SYNC_ENABLED && parsed.PRODUCT_MEDIA_DIR === undefined) {
        extra.push('PRODUCT_MEDIA_DIR: is required when PRODUCT_MEDIA_SYNC_ENABLED=true (persistent directory of the photo store).');
      }
      if (parsed.PRODUCT_MEDIA_ALLOW_FAKE_GATEWAY && parsed.NODE_ENV === 'production' && values['ALLOW_FAKE_GATEWAY'] !== '1') {
        extra.push('PRODUCT_MEDIA_ALLOW_FAKE_GATEWAY: is only honoured when the worker already allows the fake gateway (ALLOW_FAKE_GATEWAY=1).');
      }
      return extra;
    });
  } catch (error) {
    if (!(error instanceof EnvValidationError)) throw error;
    problems.push(...error.problems);
  }

  let gateway: SankhyaGateway | undefined;
  try {
    gateway = createGateway(withoutEmptyValues(source), {
      validateConfiguration: validateInstallationConfiguration,
    });
  } catch (error) {
    if (!(error instanceof GatewayConfigError)) throw error;
    problems.push(...error.problems);
  }

  if (env === undefined || gateway === undefined || problems.length > 0) {
    throw new EnvValidationError('Worker', problems);
  }
  return { env, gateway, gatewayDescription: gateway.describe() };
}
