import type { Secret } from '@salesforce/sankhya';
import { PgBoss } from 'pg-boss';
import { QUEUE_REGISTRY, type QueueSpec } from './queues.js';

export interface QueueInstallResult {
  readonly created: readonly string[];
  readonly updated: readonly string[];
}

/**
 * One-shot installation of the pg-boss schema and of the registered queues (DATA-2 applies to the
 * pg-boss schema too: it is installed before the new version runs, never at API/Worker start).
 * Idempotent and safe to repeat: pg-boss serializes its own installation with an advisory lock, existing
 * queues get their options refreshed from the registry. Nothing is dropped or truncated.
 */
export async function installQueues(
  databaseUrl: Secret,
  options: { specs?: readonly QueueSpec[]; log?: (message: string) => void } = {},
): Promise<QueueInstallResult> {
  const specs = options.specs ?? QUEUE_REGISTRY;
  const log = options.log ?? (() => undefined);

  const boss = new PgBoss({
    connectionString: databaseUrl.reveal(),
    application_name: 'salesforce-queue-install',
    max: 2,
    migrate: true,
    createSchema: true,
    // Install only: no maintenance or scheduling loops in this one-shot process.
    supervise: false,
    schedule: false,
  });
  boss.on('error', (error) => log(`pg-boss error: ${error.message}`));

  const created: string[] = [];
  const updated: string[] = [];
  try {
    await boss.start();
    for (const spec of specs) {
      if ((await boss.getQueue(spec.name)) === null) {
        await boss.createQueue(spec.name, spec.options);
        created.push(spec.name);
        log(`queue created: ${spec.name}`);
      } else {
        // `policy` and `partition` are immutable after creation.
        const { policy: _policy, partition: _partition, ...updatable } = spec.options;
        await boss.updateQueue(spec.name, updatable);
        updated.push(spec.name);
        log(`queue up to date: ${spec.name}`);
      }
    }
  } finally {
    await boss.stop({ graceful: false, close: true });
  }
  return { created, updated };
}
