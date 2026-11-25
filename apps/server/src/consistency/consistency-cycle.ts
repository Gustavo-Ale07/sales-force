import type { RequestBudget } from '@salesforce/sankhya';
import type { Logger } from '../observability/logger.js';
import type { ConsistencyVerifier } from './consistency-verifier.js';

/** At most one automatic pass per window. */
export const CONSISTENCY_MIN_INTERVAL_MS = 10 * 60_000;
/** Skip when this share of the Sankhya request budget is already used. */
export const CONSISTENCY_BUDGET_SKIP_RATIO = 0.8;

/** `CONSISTENCY_CHECK_ENABLED`: default OFF in code; only an explicit true-like value opens it. */
export function isConsistencyCheckEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  const raw = env['CONSISTENCY_CHECK_ENABLED']?.trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

export interface ConsistencyCycleDeps {
  readonly verifier: Pick<ConsistencyVerifier, 'run'>;
  readonly logger: Logger;
  readonly now?: () => number;
  readonly budget?: Pick<RequestBudget, 'used' | 'limit' | 'exhausted'>;
  readonly minIntervalMs?: number;
}

export type ConsistencyCycleResult = 'ran' | 'throttled' | 'in_flight' | 'budget_tight' | 'failed';

/**
 * Automatic pass after a mirror sync cycle. Never throws and never blocks the caller beyond the pass itself: every failure is
 * logged and swallowed, a pass is skipped while another runs, inside the 10-minute window, or when the budget is tight.
 */
export class ConsistencyCycle {
  #inFlight = false;
  #lastStartedAt: number | null = null;

  constructor(private readonly deps: ConsistencyCycleDeps) {}

  async afterSync(): Promise<ConsistencyCycleResult> {
    const { logger, budget } = this.deps;
    const now = (this.deps.now ?? Date.now)();
    if (this.#inFlight) return 'in_flight';
    if (this.#lastStartedAt !== null && now - this.#lastStartedAt < (this.deps.minIntervalMs ?? CONSISTENCY_MIN_INTERVAL_MS)) return 'throttled';
    if (budget !== undefined && (budget.exhausted || budget.used >= budget.limit * CONSISTENCY_BUDGET_SKIP_RATIO)) {
      logger.info({ used: budget.used, limit: budget.limit }, 'consistency check skipped: Sankhya request budget is tight');
      return 'budget_tight';
    }
    this.#inFlight = true;
    this.#lastStartedAt = now;
    try {
      await this.deps.verifier.run();
      return 'ran';
    } catch (error) {
      logger.warn({ err: error instanceof Error ? error.name : 'unknown' }, 'consistency check failed; the sync is not affected');
      return 'failed';
    } finally {
      this.#inFlight = false;
    }
  }
}
