import {
  createGateway,
  GatewayConfigError,
  type GatewayDescription,
  type SankhyaGateway,
} from '@salesforce/sankhya';
import { z } from 'zod';
import { DEFAULT_MIRROR_CRONS } from '../sync/schedules.js';
import { validateInstallationConfiguration } from '../configuration/validate.js';
import {
  databaseUrlField,
  EnvValidationError,
  integerField,
  logLevelField,
  nodeEnvField,
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
    .regex(/^S+(s+S+){4}$/, { error: 'must be a 5-field cron expression, e.g. "*/10 * * * *".' })
    .default(defaultValue);

export const WorkerEnvSchema = z.object({
  NODE_ENV: nodeEnvField,
  DATABASE_URL: databaseUrlField,
  LOG_LEVEL: logLevelField,
  DB_POOL_MAX: integerField({ min: 1, max: 100 }, 10),
  /** Loopback health endpoint used by the container HEALTHCHECK. Never bind it to a public address. */
  WORKER_HEALTH_HOST: z.string().min(1).default('127.0.0.1'),
  WORKER_HEALTH_PORT: portField(3001),
  /** Cron expression (5 fields) of the `sync.heartbeat` scheduled job. */
  HEARTBEAT_CRON: z
    .string()
    .regex(/^\S+(\s+\S+){4}$/, { error: 'must be a 5-field cron expression, e.g. "* * * * *".' })
    .default('* * * * *'),
  /**
   * Mirror synchronization (WP 0.8). `false` = no scheduled mirror jobs (a manual `sync:once` still
   * works). The default crons are the PROPOSED frequencies of the spec (RF-SNK-1, spike §4) and stay
   * proposals until the Sankhya request limits are measured (S0.2).
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
    env = parseEnv('Worker', WorkerEnvSchema, source);
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
