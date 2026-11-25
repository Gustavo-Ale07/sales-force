import type { MirrorEntity } from '../sync/mirror-entities.js';
import { MirrorSyncService, type MirrorRunResult } from '../sync/mirror-sync.service.js';
import type { ConsistencyCycle } from './consistency-cycle.js';

/**
 * Mirror service that, after a run that completed, hands over to the consistency cycle without waiting for it and without
 * letting it affect the run (the cycle never throws; the promise is detached on purpose). The returned result is the mirror's own.
 */
export class ConsistencyAwareMirrorSyncService extends MirrorSyncService {
  #cycle: ConsistencyCycle | null = null;

  attachConsistencyCycle(cycle: ConsistencyCycle): void {
    this.#cycle = cycle;
  }

  override async run(entity: MirrorEntity, options: { signal?: AbortSignal } = {}): Promise<MirrorRunResult> {
    const result = await super.run(entity, options);
    const cycle = this.#cycle;
    if (cycle !== null && result.outcome === 'completed') {
      // Runs after the mirror mutex is released; the verifier takes it again per type.
      void cycle.afterSync().catch(() => undefined);
    }
    return result;
  }
}
