import type { Queue } from 'pg-boss';
import { MIRROR_ENTITIES, mirrorQueueName } from '../sync/mirror-entities.js';

/**
 * Queue registry (STACK-6). pg-boss executes jobs; `integration_outbox` (a table) stays the business
 * record of every Sankhya delivery, so no queue here is a system of record.
 *
 * Adding a queue = add it here; `queue:install` (one-shot, DATA-2) creates it before the new version
 * runs, and the worker refuses to start when a registered queue is missing.
 *
 * Names use `<area>.<action>`; only letters, digits, `.`, `_`, `-` and `/` are valid in pg-boss.
 */
export const QUEUE_NAMES = {
  /** Terminal failures (permanent, or retries exhausted) end up here for operator inspection. */
  deadLetter: 'platform.dead-letter',
  /** Scheduled proof of life of the worker and of the queue (no business effect). */
  syncHeartbeat: 'sync.heartbeat',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface QueueSpec {
  readonly name: string;
  readonly options: Omit<Queue, 'name'>;
}

/**
 * Mirror sync queues. Policy `short` keeps at most one job queued (a slow run never piles up ticks);
 * the per-entity advisory lock is the real guard against double runs. Transient failures
 * (unavailable, rate limit, temporary) are retried with exponential backoff (30 s, doubling, capped
 * at 15 min) up to 5 times, then dead-lettered; permanent ones never retry (see `retry.ts`).
 * `expireInSeconds` bounds one run.
 */
const MIRROR_QUEUE_OPTIONS: Omit<Queue, 'name'> = {
  policy: 'short',
  retryLimit: 5,
  retryDelay: 30,
  retryBackoff: true,
  retryDelayMax: 900,
  expireInSeconds: 1800,
  retentionSeconds: 3600,
  deleteAfterSeconds: 24 * 3600,
  deadLetter: QUEUE_NAMES.deadLetter,
};

/**
 * Retry policy of a queue = `retryLimit` / `retryDelay` / `retryBackoff` / `retryDelayMax` in its
 * options (exponential backoff for failures the handler classified as retryable). Permanent failures
 * never consume retries: the runner sends them straight to the dead-letter queue (`retry.ts`).
 * Business queues added later declare their own policy here.
 *
 * Order matters: the dead-letter queue must exist before queues that reference it. */
export const QUEUE_REGISTRY: readonly QueueSpec[] = [
  {
    name: QUEUE_NAMES.deadLetter,
    options: { retentionSeconds: 30 * 24 * 3600, deleteAfterSeconds: 30 * 24 * 3600 },
  },
  {
    name: QUEUE_NAMES.syncHeartbeat,
    options: {
      // The next scheduled run replaces a failed one: no retries for the heartbeat.
      retryLimit: 0,
      expireInSeconds: 60,
      retentionSeconds: 3600,
      deleteAfterSeconds: 3600,
      deadLetter: QUEUE_NAMES.deadLetter,
    },
  },
  // Mirror synchronization: one queue per entity (`sync.mirror.<entity>`).
  ...MIRROR_ENTITIES.map((entity): QueueSpec => ({ name: mirrorQueueName(entity), options: MIRROR_QUEUE_OPTIONS })),
];
