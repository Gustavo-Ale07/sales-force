import { createDb } from '@salesforce/db';
import { BootstrapFileConfigurationSource, DEMO_CONFIGURATION } from '@salesforce/sankhya';
import { z } from 'zod';
import { InstallationConfigurationRepository } from './configuration/configuration.repository.js';
import { validateInstallationConfiguration } from './configuration/validate.js';
import { databaseUrlField, nodeEnvField, parseEnv } from './config/env.js';
import { runMain } from './process.js';

/**
 * Development seed (`pnpm db:seed`). Stage 1a seeds only the installation configuration snapshot so
 * the API can leave `installation_not_enabled` locally:
 *
 * - `SF_CONFIG_FILE` set: the bootstrap file is read and validated (U-11; CFG-1's physical model is
 *   PROPOSED, so the file is the interim source);
 * - otherwise: the synthetic demo configuration of the fake Sankhya gateway.
 *
 * Dev accounts arrive with authentication (Stage 1b). Refuses to run in production: production
 * configuration is governed from Sankhya, never seeded.
 */
const SeedEnvSchema = z.object({
  NODE_ENV: nodeEnvField,
  DATABASE_URL: databaseUrlField,
  SF_CONFIG_FILE: z.string().min(1).optional(),
});

runMain('seed', async () => {
  const env = parseEnv('seed', SeedEnvSchema, process.env, (parsed) =>
    parsed.NODE_ENV === 'production' ? ['NODE_ENV: the development seed refuses to run when NODE_ENV=production.'] : [],
  );

  const source =
    env.SF_CONFIG_FILE === undefined
      ? undefined
      : new BootstrapFileConfigurationSource({ path: env.SF_CONFIG_FILE, validate: validateInstallationConfiguration });
  const configuration = source === undefined ? DEMO_CONFIGURATION : await source.read();

  const db = createDb(env.DATABASE_URL.reveal(), { max: 2, applicationName: 'salesforce-seed' });
  try {
    const result = await new InstallationConfigurationRepository(db.db).saveSnapshot(configuration, new Date());
    process.stdout.write(
      result.stored
        ? `installation configuration stored (${configuration.source.kind}, ${result.contentHash})\n`
        : `installation configuration unchanged (${result.contentHash})\n`,
    );
  } finally {
    await db.close();
  }
});
