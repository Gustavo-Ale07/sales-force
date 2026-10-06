import { z } from 'zod';
import type { ProductMediaSyncService } from '../../media/product-media-sync.service.js';
import type { JobContext, JobHandler } from '../job-contract.js';
import { QUEUE_NAMES } from '../queues.js';

/**
 * `media.products`: one scheduled run of the product photo synchronization. Reads the ERP through the
 * media read port only (no write), stores validated images in the object store. Failures are recorded in
 * `sync_state` by the service and rethrown, so the runner retries the retryable ones with the queue's
 * backoff and dead-letters the rest. A second concurrent run skips (advisory lock).
 */
export class ProductMediaSyncJob implements JobHandler<Record<string, never>> {
  readonly queue = QUEUE_NAMES.mediaProducts;
  readonly payload = z.object({});

  constructor(private readonly service: ProductMediaSyncService) {}

  async handle(_payload: Record<string, never>, context: JobContext): Promise<void> {
    await this.service.run(context.signal === undefined ? {} : { signal: context.signal });
  }
}
