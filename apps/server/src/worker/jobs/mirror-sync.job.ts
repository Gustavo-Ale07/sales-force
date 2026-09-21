import { z } from 'zod';
import { mirrorQueueName, type MirrorEntity } from '../../sync/mirror-entities.js';
import type { MirrorSyncService } from '../../sync/mirror-sync.service.js';
import type { JobContext, JobHandler } from '../job-contract.js';

/**
 * `sync.mirror.<entity>`: one scheduled mirror synchronization of one entity (RF-SNK-1/2/8 subset).
 * The job is the only place in the Worker that reads from Sankhya, through `MirrorSyncService`
 * (read port only). Failures are recorded in `sync_state` by the service and rethrown here so the
 * runner retries the retryable ones with the queue's backoff and dead-letters the rest.
 */
export class MirrorSyncJob implements JobHandler<Record<string, never>> {
  readonly queue: string;
  readonly payload = z.object({});

  constructor(
    private readonly entity: MirrorEntity,
    private readonly service: MirrorSyncService,
  ) {
    this.queue = mirrorQueueName(entity);
  }

  async handle(_payload: Record<string, never>, context: JobContext): Promise<void> {
    await this.service.run(this.entity, context.signal === undefined ? {} : { signal: context.signal });
  }
}
