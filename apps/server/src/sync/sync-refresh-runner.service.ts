import { SYNC_REFRESH_ENTITIES, type SyncRefreshEntity, type SyncRefreshStep } from '@salesforce/contracts';
import { syncRefresh, type DbHandle } from '@salesforce/db';
import { and, eq, lt } from 'drizzle-orm';
import type { OrderErpStatusService } from '../integration/order-erp-status.service.js';
import type { Logger } from '../observability/logger.js';
import type { Clock } from '../platform/tokens.js';
import type { ConfigurationSyncService } from './configuration-sync.service.js';
import { describeSyncFailure } from './failure.js';
import { PermanentJobError } from '../worker/job-contract.js';
import type { MirrorSyncService } from './mirror-sync.service.js';

/** A run still `running` after this long is taken as interrupted (worker restart) and closed, so the next click works. */
export const SYNC_REFRESH_STALE_MS = 30 * 60_000;

export interface SyncRefreshRunnerDeps {
  readonly db: DbHandle;
  readonly mirror: Pick<MirrorSyncService, 'run'>;
  /** Present only with CONFIG_SYNC_FROM_SANKHYA=1. */
  readonly configuration?: Pick<ConfigurationSyncService, 'run'>;
  /** Present only while the order-write switch is on. */
  readonly orderStatus?: Pick<OrderErpStatusService, 'runOnce'>;
  readonly logger: Logger;
  readonly now: Clock;
}

interface StepResult {
  readonly status: 'ok' | 'skipped';
  readonly rowsRead: number | null;
  readonly reason: string | null;
}

/**
 * D-AB B3 (worker side): runs one `sync_refresh` request. Read-only toward Sankhya: it reuses the same services as the
 * scheduled syncs (same eligibility filters, same fail-closed behavior), so a failed entity keeps its old rows. Progress
 * is written after every step (counts and masked reasons only). One failed step never stops the following ones.
 */
export class SyncRefreshRunner {
  constructor(private readonly deps: SyncRefreshRunnerDeps) {}

  /** Ids waiting for the worker, oldest first. */
  async pendingIds(): Promise<string[]> {
    const rows = await this.deps.db.db
      .select({ id: syncRefresh.id })
      .from(syncRefresh)
      .where(eq(syncRefresh.status, 'pending'))
      .orderBy(syncRefresh.requestedAt);
    return rows.map((row) => row.id);
  }

  /** Closes a run that stayed `running` past the limit; its unfinished steps become failed. */
  async closeStale(): Promise<number> {
    const { db, now } = this.deps;
    const limit = new Date(now().getTime() - SYNC_REFRESH_STALE_MS);
    const stale = await db.db
      .select()
      .from(syncRefresh)
      .where(and(eq(syncRefresh.status, 'running'), lt(syncRefresh.startedAt, limit)));
    for (const row of stale) {
      const steps = (row.steps as SyncRefreshStep[]).map((step) =>
        step.status === 'pending' || step.status === 'running'
          ? { ...step, status: 'failed' as const, reason: 'Leitura interrompida antes de terminar.' }
          : step,
      );
      // Stamped with its start, not now: the 60 s cooldown must not hand an interrupted run back to the next click.
      const finishedAt = row.startedAt ?? limit;
      await db.db.update(syncRefresh).set({ status: 'done', finishedAt, steps }).where(eq(syncRefresh.id, row.id));
    }
    return stale.length;
  }

  async run(id: string, options: { signal?: AbortSignal } = {}): Promise<void> {
    const { db, logger, now } = this.deps;
    const [claimed] = await db.db
      .update(syncRefresh)
      .set({ status: 'running', startedAt: now() })
      .where(and(eq(syncRefresh.id, id), eq(syncRefresh.status, 'pending')))
      .returning();
    if (claimed === undefined) return; // already claimed, done, or unknown: idempotent
    const steps: SyncRefreshStep[] = SYNC_REFRESH_ENTITIES.map((entity) => ({
      entity,
      status: 'pending',
      rowsRead: null,
      durationMs: null,
      reason: null,
      lastSuccessAt: null,
    }));
    const save = () => db.db.update(syncRefresh).set({ steps }).where(eq(syncRefresh.id, id));
    await save();

    for (const [index, entity] of SYNC_REFRESH_ENTITIES.entries()) {
      const startedAt = now().getTime();
      steps[index] = { ...steps[index]!, status: 'running' };
      await save();
      let next: SyncRefreshStep;
      try {
        const result = await this.#runStep(entity, options.signal);
        next = { ...steps[index]!, status: result.status, rowsRead: result.rowsRead, reason: result.reason };
      } catch (error) {
        const failure = describeSyncFailure(error);
        logger.warn({ entity, errorClass: failure.errorClass, errorCode: failure.errorCode }, 'on-demand refresh step failed');
        next = { ...steps[index]!, status: 'failed', reason: failure.message };
      }
      steps[index] = { ...next, durationMs: Math.max(0, now().getTime() - startedAt) };
      await save();
    }
    await db.db.update(syncRefresh).set({ status: 'done', finishedAt: now(), steps }).where(eq(syncRefresh.id, id));
    logger.info({ refreshId: id, failed: steps.filter((step) => step.status === 'failed').length }, 'on-demand refresh finished');
  }

  async #runStep(entity: SyncRefreshEntity, signal: AbortSignal | undefined): Promise<StepResult> {
    const withSignal = signal === undefined ? {} : { signal };
    if (entity === 'configuration') {
      const { configuration } = this.deps;
      if (configuration === undefined) return skipped('Leitura da configuração desativada nesta instalação.');
      const result = await configuration.run(withSignal);
      return result.outcome === 'skipped_locked' ? skipped('Outra leitura desta informação já estava em andamento.') : { status: 'ok', rowsRead: null, reason: null };
    }
    if (entity === 'orderStatus') {
      const { orderStatus } = this.deps;
      if (orderStatus === undefined) return skipped('Envio de pedidos ao Sankhya desativado nesta instalação.');
      const result = await orderStatus.runOnce(withSignal);
      if (result.failed === true) throw new PermanentJobError('A consulta ao Sankhya falhou; os status guardados foram mantidos.');
      return { status: 'ok', rowsRead: result.checked, reason: null };
    }
    const result = await this.deps.mirror.run(entity, withSignal);
    if (result.outcome === 'skipped_locked') return skipped('Outra leitura desta informação já estava em andamento.');
    if (result.outcome === 'unsupported') throw new PermanentJobError('Leitura ainda não disponível para esta informação.');
    return { status: 'ok', rowsRead: result.stats?.read ?? null, reason: null };
  }
}

function skipped(reason: string): StepResult {
  return { status: 'skipped', rowsRead: null, reason };
}
