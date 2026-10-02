import { z } from 'zod';
import { databaseUrlField, nodeEnvField, parseEnv, type EnvSource } from './env.js';

/**
 * Environment of the one-shot `config-bootstrap` command (staging / production): loads a validated installation
 * configuration file as the current snapshot (CFG-1, U-11 bootstrap file). It is not the development seed:
 *
 * - `NODE_ENV` is required and must be `production` (development uses `pnpm db:seed`, which refuses production);
 * - `INSTALLATION_CONFIG_FILE` is required (a path inside the container; mount the file read-only);
 * - `DATABASE_URL` must be the owner role of the schema (`force_migrator`, `migrate.env`): the API and worker roles
 *   have no write grant on the snapshot table, by design.
 */
export const ConfigBootstrapEnvSchema = z.object({
  NODE_ENV: nodeEnvField,
  DATABASE_URL: databaseUrlField,
  INSTALLATION_CONFIG_FILE: z.string({ error: 'is required: the path of the configuration file inside the container.' }).min(1),
});

export function parseConfigBootstrapEnv(source: EnvSource) {
  return parseEnv('config-bootstrap', ConfigBootstrapEnvSchema, source, (parsed) =>
    parsed.NODE_ENV === 'production'
      ? []
      : ['NODE_ENV: config-bootstrap is for staging/production only (NODE_ENV=production); use `pnpm db:seed` in development.'],
  );
}
