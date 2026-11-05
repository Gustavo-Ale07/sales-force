import { AsyncLocalStorage } from 'node:async_hooks';
import { SankhyaGatewayError } from './errors.js';
import type { HttpTransport } from './real/transport.js';

/** Stable error code of a refused request; the order delivery parks the row on it (M3). */
export const BUDGET_EXHAUSTED_CODE = 'request_budget_exhausted';

/** Default of the Sandbox test #1 (`docs/implementation/snk-7-dry-run.md` §4). */
export const DEFAULT_LIVE_REQUEST_BUDGET = 40;

const active = new AsyncLocalStorage<RequestBudget>();

/**
 * M3: a cap on the HTTP requests the order delivery may make to Sankhya in one worker run. It counts every request
 * made while `run()` is on the call stack (token, origin lookups, includes, confirmations, rereads), whatever its
 * outcome, and refuses the next one locally (no network) once the limit is reached. Reads of the mirror sync run
 * outside `run()` and are not counted. The counter lives in memory: restarting the worker is the owner's explicit
 * way to start a new budget.
 */
export class RequestBudget {
  private count = 0;

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('The request budget must be a positive integer.');
  }

  get used(): number {
    return this.count;
  }

  get exhausted(): boolean {
    return this.count >= this.limit;
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    return active.run(this, fn);
  }

  /** @internal Called by `budgetedTransport` before each request. */
  charge(): void {
    if (this.count >= this.limit) {
      throw new SankhyaGatewayError('temporary', {
        code: BUDGET_EXHAUSTED_CODE,
        message: `The test request budget (${this.limit}) is exhausted; no further request is sent.`,
      });
    }
    this.count += 1;
  }
}

export function isBudgetExhaustedError(error: unknown): boolean {
  return error instanceof SankhyaGatewayError && error.code === BUDGET_EXHAUSTED_CODE;
}

/** Wraps a transport so requests made inside `RequestBudget.run()` are counted and capped. A no-op outside it. */
export function budgetedTransport(inner: HttpTransport): HttpTransport {
  return (request) => {
    active.getStore()?.charge();
    return inner(request);
  };
}
