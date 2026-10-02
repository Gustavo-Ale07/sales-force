import { createDb } from '@salesforce/db';
import { BootstrapFileConfigurationSource, DEMO_ACCOUNTS } from '@salesforce/sankhya';
import { parseConfigBootstrapEnv } from './config/config-bootstrap-env.js';
import { bootstrapConfigurationProblems } from './configuration/bootstrap-guard.js';
import { InstallationConfigurationRepository } from './configuration/configuration.repository.js';
import { validateInstallationConfiguration } from './configuration/validate.js';
import { runMain } from './process.js';

/**
 * One-shot, idempotent (staging / production): validates the installation configuration file against the
 * `packages/contracts` schema and stores it as the current snapshot (`installation_configuration_version`).
 * Run it as `force_migrator` (the migrate service), after `migrate` and before the first start:
 *
 *   docker compose ... run --rm -v <file>:/config/installation.json:ro \
 *     -e INSTALLATION_CONFIG_FILE=/config/installation.json migrate node dist/config-bootstrap.js
 *
 * The same content is a no-op (content hash, `syncedAt` excluded); changed content becomes a new current version
 * and the previous ones are kept. Refuses a file carrying demo accounts or demo metrics. The file holds
 * configuration only, never a secret. The source is always `bootstrap-file` (U-11 stays UNDECIDED as the long-term
 * source: this is the mechanism, the content is the owner's).
 */
runMain('config-bootstrap', async () => {
  const env = parseConfigBootstrapEnv(process.env);
  const source = new BootstrapFileConfigurationSource({
    path: env.INSTALLATION_CONFIG_FILE,
    validate: validateInstallationConfiguration,
  });
  const configuration = await source.read();
  const problems = bootstrapConfigurationProblems(
    configuration,
    DEMO_ACCOUNTS.map((account) => account.email),
  );
  if (problems.length > 0) {
    throw new Error(`the configuration file was refused:\n- ${problems.join('\n- ')}`);
  }

  const db = createDb(env.DATABASE_URL.reveal(), { max: 2, applicationName: 'salesforce-config-bootstrap' });
  try {
    const saved = await new InstallationConfigurationRepository(db.db).saveSnapshot(configuration, new Date());
    process.stdout.write(
      saved.stored
        ? `installation configuration stored (${configuration.source.kind}, ${saved.contentHash})\n`
        : `installation configuration unchanged (${saved.contentHash})\n`,
    );
  } finally {
    await db.close();
  }
});
