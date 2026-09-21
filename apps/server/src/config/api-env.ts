import { z } from 'zod';
import {
  databaseUrlField,
  integerField,
  logLevelField,
  nodeEnvField,
  parseEnv,
  portField,
  type EnvSource,
} from './env.js';

/**
 * API process environment (STACK-2/STACK-3). The API never reads `SANKHYA_*` or any other Sankhya
 * setting: unknown variables are ignored, so a stray credential in the API environment is never
 * even parsed. Everything the API needs to say about the integration comes from the database.
 */
export const ApiEnvSchema = z.object({
  NODE_ENV: nodeEnvField,
  DATABASE_URL: databaseUrlField,
  LOG_LEVEL: logLevelField,
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: portField(3000),
  DB_POOL_MAX: integerField({ min: 1, max: 100 }, 10),
  // Only `dev` exists today (Stage 1b decides the authentication implementation). Kept here so the
  // production guard below exists before any authentication code does.
  AUTH_MODE: z.enum(['dev'], { error: "must be 'dev' (the only mode that exists today)." }).default('dev'),
});

export type ApiEnv = z.output<typeof ApiEnvSchema>;

export function parseApiEnv(source: EnvSource): ApiEnv {
  return parseEnv('API', ApiEnvSchema, source, (env) =>
    env.NODE_ENV === 'production' && env.AUTH_MODE === 'dev'
      ? ['AUTH_MODE: the dev mode is refused when NODE_ENV=production.']
      : [],
  );
}
