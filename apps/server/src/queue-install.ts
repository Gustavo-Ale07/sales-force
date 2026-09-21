import { z } from 'zod';
import { parseEnv, databaseUrlField, logLevelField } from './config/env.js';
import { runMain } from './process.js';
import { installQueues } from './worker/queue-installer.js';

/**
 * One-shot: installs the pg-boss schema and the registered queues (DATA-2). Run it after the
 * `db:migrate` step and before starting the new Worker version (`pnpm db:queue:install`). Idempotent.
 */
const QueueInstallEnvSchema = z.object({
  DATABASE_URL: databaseUrlField,
  LOG_LEVEL: logLevelField,
});

runMain('queue-install', async () => {
  const env = parseEnv('queue-install', QueueInstallEnvSchema, process.env);
  const result = await installQueues(env.DATABASE_URL, {
    log: (message) => process.stdout.write(`${message}\n`),
  });
  process.stdout.write(`queues installed: ${result.created.length} created, ${result.updated.length} updated\n`);
});
