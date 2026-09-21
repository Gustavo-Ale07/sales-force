import type { Queue } from 'pg-boss';

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
];
