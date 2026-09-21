import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * Correlation context of the current unit of work: an HTTP request (`requestId`) or a job run
 * (`jobId`, `queue`). Every log line of the async call chain carries it (logger `mixin`).
 */
export type LogContext = Readonly<Record<string, string>>;

const storage = new AsyncLocalStorage<LogContext>();

export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentLogContext(): LogContext | undefined {
  return storage.getStore();
}

/** Accepted inbound correlation ids: short, printable, no whitespace or control characters. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export const REQUEST_ID_HEADER = 'x-request-id';

export function isAcceptableRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

/** Uses the caller's `x-request-id` when it is well formed, otherwise generates one. */
export function resolveRequestId(header: string | string[] | undefined): string {
  const candidate = Array.isArray(header) ? header[0] : header;
  return isAcceptableRequestId(candidate) ? candidate : randomUUID();
}
