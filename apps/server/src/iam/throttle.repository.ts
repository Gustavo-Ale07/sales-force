import { Inject, Injectable } from '@nestjs/common';
import { authThrottle, type Database } from '@salesforce/db';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { DATABASE } from '../platform/tokens.js';
import { applyFailure, type FailureOutcome, type ThrottleRule, type ThrottleState } from './throttle-policy.js';

type ThrottleRow = typeof authThrottle.$inferSelect;

function toState(row: ThrottleRow): ThrottleState {
  return {
    failures: row.failures,
    windowStartedAt: row.windowStartedAt,
    lockedUntil: row.lockedUntil,
    lockoutCount: row.lockoutCount,
  };
}

/** Stale throttle rows are dropped after this long without activity (and without an active lock). */
export const THROTTLE_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Persistence of the login throttle counters (`auth_throttle`, PostgreSQL only: no Redis). Counters
 * are updated under a row lock, so concurrent failed attempts cannot lose increments.
 */
@Injectable()
export class ThrottleRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async find(key: string): Promise<ThrottleState | null> {
    const [row] = await this.db.select().from(authThrottle).where(eq(authThrottle.key, key));
    return row === undefined ? null : toState(row);
  }

  async recordFailure(key: string, now: Date, rule: ThrottleRule): Promise<FailureOutcome> {
    return this.db.transaction(async (tx) => {
      await tx
        .insert(authThrottle)
        .values({ key, failures: 0, windowStartedAt: now, lockedUntil: null, lockoutCount: 0, updatedAt: now })
        .onConflictDoNothing({ target: authThrottle.key });
      const [row] = await tx.select().from(authThrottle).where(eq(authThrottle.key, key)).for('update');
      if (row === undefined) throw new Error('auth_throttle row vanished inside its transaction');

      const outcome = applyFailure(toState(row), now, rule);
      await tx
        .update(authThrottle)
        .set({
          failures: outcome.state.failures,
          windowStartedAt: outcome.state.windowStartedAt,
          lockedUntil: outcome.state.lockedUntil,
          lockoutCount: outcome.state.lockoutCount,
          updatedAt: now,
        })
        .where(eq(authThrottle.key, key));
      return outcome;
    });
  }

  /** Forgets a key: failures, lock and lockout history (successful login, administrative unlock). */
  async clear(key: string): Promise<boolean> {
    const removed = await this.db.delete(authThrottle).where(eq(authThrottle.key, key)).returning({ key: authThrottle.key });
    return removed.length > 0;
  }

  /** Drops rows idle for `THROTTLE_RETENTION_MS` that are not currently locked. Keeps the table bounded. */
  async purgeStale(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - THROTTLE_RETENTION_MS);
    const removed = await this.db
      .delete(authThrottle)
      .where(
        and(
          lt(authThrottle.updatedAt, cutoff),
          or(isNull(authThrottle.lockedUntil), lt(authThrottle.lockedUntil, now)),
        ),
      )
      .returning({ key: authThrottle.key });
    return removed.length;
  }
}
