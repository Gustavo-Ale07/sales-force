/**
 * Login throttling rules (RF-IAM-2). Pure: no clock, no I/O, no framework. The state lives in
 * `auth_throttle`; the repository loads a row under a lock, applies these functions and stores the
 * result.
 */

export interface ThrottleRule {
  /** Failures inside `windowMs` that trigger a lockout. */
  readonly maxFailures: number;
  /** Failures older than this are forgotten. */
  readonly windowMs: number;
  /** Duration of the first lockout; each consecutive lockout doubles it. */
  readonly baseLockMs: number;
  /** Upper bound of a lockout. */
  readonly maxLockMs: number;
}

export interface ThrottleState {
  readonly failures: number;
  readonly windowStartedAt: Date;
  readonly lockedUntil: Date | null;
  /** Consecutive lockouts since the last success. */
  readonly lockoutCount: number;
}

export interface FailureOutcome {
  readonly state: ThrottleState;
  /** True when this very failure started a lockout. */
  readonly lockedNow: boolean;
}

/** The moment the lock ends when the key is locked at `now`, otherwise `null`. */
export function activeLockUntil(state: ThrottleState | null, now: Date): Date | null {
  if (state?.lockedUntil == null) return null;
  return state.lockedUntil.getTime() > now.getTime() ? state.lockedUntil : null;
}

/** `base * 2^(consecutive lockouts so far)`, capped. */
export function lockDurationMs(lockoutsSoFar: number, rule: ThrottleRule): number {
  const factor = 2 ** Math.min(lockoutsSoFar, 30);
  return Math.min(rule.baseLockMs * factor, rule.maxLockMs);
}

export function applyFailure(state: ThrottleState | null, now: Date, rule: ThrottleRule): FailureOutcome {
  // Attempts made while locked never reach here; if one does, the lock is neither extended nor reset.
  if (state !== null && activeLockUntil(state, now) !== null) return { state, lockedNow: false };

  const windowExpired =
    state === null || now.getTime() - state.windowStartedAt.getTime() >= rule.windowMs;
  const failures = (windowExpired ? 0 : (state?.failures ?? 0)) + 1;
  const lockoutCount = state?.lockoutCount ?? 0;

  if (failures >= rule.maxFailures) {
    return {
      lockedNow: true,
      state: {
        failures: 0,
        windowStartedAt: now,
        lockedUntil: new Date(now.getTime() + lockDurationMs(lockoutCount, rule)),
        lockoutCount: lockoutCount + 1,
      },
    };
  }
  return {
    lockedNow: false,
    state: {
      failures,
      windowStartedAt: windowExpired || state === null ? now : state.windowStartedAt,
      lockedUntil: null,
      lockoutCount,
    },
  };
}
