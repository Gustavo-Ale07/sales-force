import { z } from 'zod';
import type { Database } from '@salesforce/db';
import { recordWorkerHeartbeat, type WorkerHeartbeatCursor } from '../../platform/worker-heartbeat.js';
import type { JobContext, JobHandler } from '../job-contract.js';
import { QUEUE_NAMES } from '../queues.js';

/**
 * `sync.heartbeat`: scheduled proof of life. It has no business effect: it records that the worker
 * is running and which gateway mode it uses (so the API can report it without reading Sankhya
 * settings, STACK-3), and feeds the worker's own health signal. Idempotent by construction (an
 * upsert of one row).
 */
export class SyncHeartbeatJob implements JobHandler<Record<string, never>> {
  readonly queue = QUEUE_NAMES.syncHeartbeat;
  readonly payload = z.object({});

  constructor(
    private readonly db: Database,
    private readonly cursor: WorkerHeartbeatCursor,
    private readonly onBeat: (at: Date) => void,
  ) {}

  async handle(_payload: Record<string, never>, context: JobContext): Promise<void> {
    const at = context.now();
    await recordWorkerHeartbeat(this.db, this.cursor, at);
    this.onBeat(at);
    context.logger.debug({ at: at.toISOString() }, 'heartbeat recorded');
  }
}
