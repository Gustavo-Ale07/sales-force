import { z } from 'zod';
import type { SyncRefreshRunner } from '../../sync/sync-refresh-runner.service.js';
import type { JobContext, JobHandler } from '../job-contract.js';
import { QUEUE_NAMES } from '../queues.js';

/**
 * `sync.refresh.on-demand` (D-AB B3): one "Atualizar dados" request recorded by the API in `sync_refresh`. The worker's
 * poller enqueues it (the API has no queue access); the runner claims the row, so a duplicate delivery does nothing.
 */
export class SyncRefreshJob implements JobHandler<{ refreshId: string }> {
  readonly queue = QUEUE_NAMES.syncRefreshOnDemand;
  readonly payload = z.object({ refreshId: z.string().uuid() });

  constructor(private readonly runner: SyncRefreshRunner) {}

  async handle(payload: { refreshId: string }, context: JobContext): Promise<void> {
    await this.runner.run(payload.refreshId, context.signal === undefined ? {} : { signal: context.signal });
  }
}
