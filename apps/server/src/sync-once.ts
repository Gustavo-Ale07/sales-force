import { createDb, syncState } from '@salesforce/db';
import { loadWorkerConfig } from './config/worker-env.js';
import { createLogger } from './observability/logger.js';
import { runMain } from './process.js';
import { isReservedSyncEntity } from './platform/worker-heartbeat.js';
import { isMirrorEntity, MIRROR_ENTITIES, type MirrorEntity } from './sync/mirror-entities.js';
import { loadCurrentReadScope } from './sync/mirror-scope.js';
import { MirrorSyncService } from './sync/mirror-sync.service.js';

/**
 * One-shot mirror synchronization (`pnpm --filter @salesforce/server run sync:once [entity ...]`):
 * runs the same `MirrorSyncService` as the scheduled jobs, once, without pg-boss. With no argument
 * every mirror entity runs, in order. Safe next to a running worker: the per-entity advisory lock
 * makes the second runner skip. Read-only towards Sankhya (SNK-4); the gateway comes from the worker
 * environment (default: the synthetic fake). The exit code is 1 when any entity failed.
 */
runMain('sync-once', async () => {
  const requested = process.argv.slice(2).filter((arg) => arg !== '--');
  const unknown = requested.filter((arg) => !isMirrorEntity(arg));
  if (unknown.length > 0) {
    throw new Error(`Unknown entity: ${unknown.join(', ')}. Valid entities: ${MIRROR_ENTITIES.join(', ')}.`);
  }
  const entities: MirrorEntity[] = requested.length === 0 ? [...MIRROR_ENTITIES] : requested.filter(isMirrorEntity);

  const { env, gateway, gatewayDescription } = loadWorkerConfig(process.env);
  const logger = createLogger({ level: env.LOG_LEVEL, service: 'sync-once' });
  const db = createDb(env.DATABASE_URL.reveal(), { max: 4, applicationName: 'salesforce-sync-once' });
  const out = (line: string) => process.stdout.write(`${line}\n`);
  try {
    out(`gateway: ${gatewayDescription.mode} (${gatewayDescription.environmentKind})`);
    const service = new MirrorSyncService({
      db,
      gateway,
      logger,
      now: () => new Date(),
      readScope: () => loadCurrentReadScope(db.db),
    });
    const { results, failures } = await service.runAll(entities);
    for (const result of results) {
      const stats = result.stats;
      out(
        stats === null
          ? `${result.entity}: ${result.outcome}`
          : `${result.entity}: ${result.outcome} read=${stats.read} created=${stats.created} updated=${stats.updated} reactivated=${stats.reactivated} unchanged=${stats.unchanged} deactivated=${stats.deactivated}`,
      );
    }
    for (const { entity, failure } of failures) {
      out(`${entity}: FAILED [${failure.errorClass}] ${failure.message}`);
    }
    const unsupported = results.filter((result) => result.outcome === 'unsupported').map((result) => result.entity);
    for (const row of (await db.db.select().from(syncState)).filter((state) => !isReservedSyncEntity(state.entity))) {
      out(`sync_state ${row.entity}: ${row.status} rows=${row.rowCount ?? '-'} lastSuccessAt=${row.lastSuccessAt?.toISOString() ?? '-'}`);
    }
    if (failures.length > 0 || unsupported.length > 0) process.exitCode = 1;
  } finally {
    await db.close();
  }
});
