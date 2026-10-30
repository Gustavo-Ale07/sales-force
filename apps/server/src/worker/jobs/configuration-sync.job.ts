import { z } from 'zod';
import type { ConfigurationSyncService } from '../../sync/configuration-sync.service.js';
import type { JobContext, JobHandler } from '../job-contract.js';
import { QUEUE_NAMES } from '../queues.js';

/**
 * `sync.configuration` (CFG-8): reads the Vidya configuration inside Sankhya and stores a new configuration version when
 * it changed. Registered only when `CONFIG_SYNC_FROM_SANKHYA=1`. The service records every failure in `sync_state` and
 * rethrows it, so the runner dead-letters permanent ones and retries the transient ones with the next tick.
 */
export class ConfigurationSyncJob implements JobHandler<Record<string, never>> {
  readonly queue = QUEUE_NAMES.syncConfiguration;
  readonly payload = z.object({});

  constructor(private readonly service: ConfigurationSyncService) {}

  async handle(_payload: Record<string, never>, context: JobContext): Promise<void> {
    await this.service.run(context.signal === undefined ? {} : { signal: context.signal });
  }
}
