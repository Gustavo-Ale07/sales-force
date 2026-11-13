import { SYNC_REFRESH_ENTITIES, type SyncRefreshEntity } from '@salesforce/contracts';
import { syncRefresh, type DbHandle } from '@salesforce/db';
import { and, eq } from 'drizzle-orm';
import type { OrderErpStatusService } from '../integration/order-erp-status.service.js';
import type { Logger } from '../observability/logger.js';
import type { Clock } from '../platform/tokens.js';
import type { ConfigurationSyncService } from './configuration-sync.service.js';
import { describeSyncFailure } from './failure.js';
import { expireStuckRefreshes, type StoredSyncRefreshStep } from './sync-refresh-expiry.js';
import { PermanentJobError } from '../worker/job-contract.js';
import type { MirrorSyncService } from './mirror-sync.service.js';

export interface SyncRefreshRunnerDeps {
  readonly db: DbHandle;
  readonly mirror: Pick<MirrorSyncService, 'run'>;
  /** Present only with CONFIG_SYNC_FROM_SANKHYA=1. */
  readonly configuration?: Pick<ConfigurationSyncService, 'run'>;
  /** Present only while the order-write switch is on. */
  readonly orderStatus?: Pick<OrderErpStatusService, 'runOnce'> & Partial<Pick<OrderErpStatusService, 'runReleaseOnce'>>;
  readonly logger: Logger;
  readonly now: Clock;
}

interface StepResult {
  readonly status: 'ok' | 'skipped';
  readonly rowsRead: number | null;
  readonly reason: string | null;
  /** Owner ruling 2026-11-13: AD_MOBILIDADE visible/hidden counts per kind. */
  readonly mobility?: readonly NonNullable<StoredSyncRefreshStep['mobility']>[number][];
}

const MOBILITY_GUARD_REASON = 'Mobilidade: o Sankhya ocultaria quase tudo; os dados anteriores foram mantidos. Avise o TI para conferir AD_MOBILIDADE.';

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

  /** D-AD: closes requests/runs that stopped advancing (see sync-refresh-expiry.ts). */
  closeStale(): Promise<number> {
    return expireStuckRefreshes(this.deps.db.db, this.deps.now());
  }

  async run(id: string, options: { signal?: AbortSignal } = {}): Promise<void> {
    const { db, logger, now } = this.deps;
    const [claimed] = await db.db
      .update(syncRefresh)
      .set({ status: 'running', startedAt: now(), progressAt: now() })
      .where(and(eq(syncRefresh.id, id), eq(syncRefresh.status, 'pending')))
      .returning();
    if (claimed === undefined) return; // already claimed, done, or unknown: idempotent
    const steps: StoredSyncRefreshStep[] = SYNC_REFRESH_ENTITIES.map((entity) => ({
      entity,
      status: 'pending',
      rowsRead: null,
      durationMs: null,
      reason: null,
      lastSuccessAt: null,
    }));
    const save = () => db.db.update(syncRefresh).set({ steps, progressAt: now() }).where(eq(syncRefresh.id, id));
    await save();

    for (const [index, entity] of SYNC_REFRESH_ENTITIES.entries()) {
      const startedAt = now().getTime();
      steps[index] = { ...steps[index]!, status: 'running' };
      await save();
      let next: StoredSyncRefreshStep;
      try {
        const result = await this.#runStep(entity, options.signal);
        next = {
          ...steps[index]!,
          status: result.status,
          rowsRead: result.rowsRead,
          reason: result.reason,
          ...(result.mobility === undefined ? {} : { mobility: [...result.mobility] }),
        };
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
      if (result.outcome === 'skipped_locked') return skipped('Outra leitura desta informação já estava em andamento.');
      const kept = (result.mobility ?? []).some((count) => count.keptPrevious);
      return {
        status: 'ok',
        rowsRead: null,
        reason: kept ? MOBILITY_GUARD_REASON : null,
        ...(result.mobility === undefined ? {} : { mobility: result.mobility }),
      };
    }
    if (entity === 'orderStatus') {
      const { orderStatus } = this.deps;
      if (orderStatus === undefined) return skipped('Envio de pedidos ao Sankhya desativado nesta instalação.');
      const result = await orderStatus.runOnce(withSignal);
      // Release (liberação) has its own read: a status read that is not available yet must not hide a working release read.
      const release = orderStatus.runReleaseOnce === undefined ? undefined : await orderStatus.runReleaseOnce(withSignal);
      if (result.failed === true) {
        const code = result.failure?.errorCode ?? 'order_status_read_failed';
        // The real ERP status read is not validated yet (SNK-7 P2): "not available on this installation", neutral, not a failure.
        if (code === 'not_implemented') {
          if (release !== undefined && release.failed !== true) return { status: 'ok', rowsRead: release.checked, reason: null };
          return skipped('Status dos pedidos no Sankhya: ainda não disponível');
        }
        throw new PermanentJobError(`A consulta ao Sankhya falhou (${code}); os status guardados foram mantidos.`, { code });
      }
      if (release?.failed === true) {
        const code = release.failure?.errorCode ?? 'order_release_read_failed';
        if (code !== 'not_implemented') throw new PermanentJobError(`A consulta de liberação ao Sankhya falhou (${code}); os estados guardados foram mantidos.`, { code });
      }
      return { status: 'ok', rowsRead: result.checked, reason: null };
    }
    const result = await this.deps.mirror.run(entity, withSignal);
    if (result.outcome === 'skipped_locked') return skipped('Outra leitura desta informação já estava em andamento.');
    if (result.outcome === 'unsupported') throw new PermanentJobError('Leitura ainda não disponível para esta informação.');
    return {
      status: 'ok',
      rowsRead: result.stats?.read ?? null,
      reason: result.mobility?.keptPrevious === true ? MOBILITY_GUARD_REASON : null,
      ...(result.mobility === undefined ? {} : { mobility: [{ kind: 'products' as const, ...result.mobility }] }),
    };
  }
}

function skipped(reason: string): StepResult {
  return { status: 'skipped', rowsRead: null, reason };
}
