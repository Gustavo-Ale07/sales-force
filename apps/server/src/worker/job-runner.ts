import { isSankhyaGatewayError } from '@salesforce/sankhya';
import type { Job, JobResult } from 'pg-boss';
import { errorLogFields, type Logger } from '../observability/logger.js';
import { runWithLogContext } from '../observability/request-context.js';
import type { Clock } from '../platform/tokens.js';
import type { JobContext, JobHandler } from './job-contract.js';
import { PermanentJobError, TransientJobError } from './job-contract.js';
import { classifyJobFailure } from './retry.js';

export interface JobRunnerDeps {
  readonly logger: Logger;
  readonly now: Clock;
}

export type BatchHandler = (jobs: Job<object>[]) => Promise<JobResult[]>;

/** Own errors and Sankhya gateway errors are secret-free by contract; anything else is not stored. */
function safeMessage(error: unknown): string | undefined {
  if (error instanceof PermanentJobError || error instanceof TransientJobError || isSankhyaGatewayError(error)) {
    return error.message.slice(0, 500);
  }
  return undefined;
}

/**
 * Adapts a typed `JobHandler` to a pg-boss batch handler with per-job settlement:
 *
 * - the payload is validated with the handler's Zod schema; an invalid payload is a permanent
 *   failure (dead-letter queue, no retries);
 * - success -> `completed`;
 * - a retryable failure -> `failed`: pg-boss retries with the queue's exponential backoff until
 *   `retryLimit`, then the job fails terminally into the dead-letter queue;
 * - any other failure -> `deadletter`: straight to the dead-letter queue, never retried.
 *
 * One failing job never affects the others of the batch, and the runner itself never throws.
 */
export function createBatchHandler<TPayload>(
  handler: JobHandler<TPayload>,
  deps: JobRunnerDeps,
): BatchHandler {
  return async (jobs) => {
    const results: JobResult[] = [];
    for (const job of jobs) results.push(await runOne(handler, deps, job));
    return results;
  };
}

async function runOne<TPayload>(
  handler: JobHandler<TPayload>,
  deps: JobRunnerDeps,
  job: Job<object>,
): Promise<JobResult> {
  return runWithLogContext({ jobId: job.id, queue: handler.queue }, async () => {
    const { logger } = deps;
    const parsed = handler.payload.safeParse(job.data ?? {});
    if (!parsed.success) {
      logger.error(
        { issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`) },
        'job payload is invalid; not retried',
      );
      return { id: job.id, status: 'deadletter', output: { errorClass: 'invalid_payload' } };
    }

    const context: JobContext = { jobId: job.id, queue: handler.queue, logger, now: deps.now, signal: job.signal };
    try {
      await handler.handle(parsed.data, context);
      return { id: job.id, status: 'completed' };
    } catch (error) {
      const failure = classifyJobFailure(error);
      const output = {
        errorClass: failure.errorClass,
        ...(failure.errorCode !== undefined ? { errorCode: failure.errorCode } : {}),
        ...(safeMessage(error) !== undefined ? { message: safeMessage(error) } : {}),
      };
      if (failure.retry) {
        logger.warn({ ...errorLogFields(error), errorClass: failure.errorClass }, 'job failed; will be retried with backoff');
        return { id: job.id, status: 'failed', output };
      }
      logger.error({ ...errorLogFields(error), errorClass: failure.errorClass }, 'job failed permanently; sent to dead-letter queue');
      return { id: job.id, status: 'deadletter', output };
    }
  });
}
