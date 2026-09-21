import type { z } from 'zod';
import type { Logger } from '../observability/logger.js';

/**
 * What a handler may rely on. The gateway is deliberately not here: a handler that talks to Sankhya
 * receives it through its own constructor, so that it is visible which jobs touch the ERP.
 */
export interface JobContext {
  readonly jobId: string;
  readonly queue: string;
  /** Logger of the process; every line already carries `jobId` and `queue` (log context). */
  readonly logger: Logger;
  readonly now: () => Date;
  /** Aborted by pg-boss when the job expires or the worker shuts down; long jobs must honor it. */
  readonly signal?: AbortSignal;
}

/**
 * A typed job handler. The payload is validated with Zod before the handler runs (job payloads are
 * external input); an invalid payload is a permanent failure. Handlers MUST be idempotent: pg-boss
 * delivers at least once. Failures are classified in `retry.ts`: throw `TransientJobError` /
 * `PermanentJobError`, or a `SankhyaGatewayError` (classified by its `kind`).
 */
export interface JobHandler<TPayload> {
  readonly queue: string;
  readonly payload: z.ZodType<TPayload>;
  handle(payload: TPayload, context: JobContext): Promise<void>;
}

/** The job cannot succeed by repeating it: it goes to the dead-letter queue immediately. */
export class PermanentJobError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PermanentJobError';
  }
}

/** A temporary condition (dependency down, throttling): retried with backoff by pg-boss. */
export class TransientJobError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TransientJobError';
  }
}
