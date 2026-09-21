import { Inject, Injectable } from '@nestjs/common';
import { authThrottle, type Database } from '@salesforce/db';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
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
 * are updated by single atomic upserts, so concurrent failed attempts cannot lose increments.
 */
@Injectable()
export class ThrottleRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async find(key: string): Promise<ThrottleState | null> {
    const [row] = await this.db.select().from(authThrottle).where(eq(authThrottle.key, key));
    return row === undefined ? null : toState(row);
  }

  /**
   * Records one failure in ONE statement: `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`. The row
   * lock of the conflict path serializes concurrent failures of one key, so no increment is lost and
   * exactly one of them starts a lockout; there is no read-modify-write round trip and no
   * transaction. The SQL mirrors `applyFailure` (throttle-policy.ts) and is tested against it:
   *
   * - a key that is locked at `now` is not touched (`setWhere` skips the update, no row returned);
   * - a window that has ended restarts the count; reaching `maxFailures` starts a lockout of
   *   `base * 2^lockouts` capped at `maxLock`, resets the count and increments the lockout counter.
   */
  async recordFailure(key: string, now: Date, rule: ThrottleRule): Promise<FailureOutcome> {
    const initial = applyFailure(null, now, rule).state;
    const nowSql = sql`${now.toISOString()}::timestamptz`;
    const windowExpired = sql`(${nowSql} - ${authThrottle.windowStartedAt} >= ${rule.windowMs}::float8 * interval '1 millisecond')`;
    const nextFailures = sql`(CASE WHEN ${windowExpired} THEN 0 ELSE ${authThrottle.failures} END + 1)`;
    const locks = sql`(${nextFailures} >= ${rule.maxFailures})`;
    const lockMs = sql`LEAST(${rule.baseLockMs}::float8 * power(2, LEAST(${authThrottle.lockoutCount}, 30)), ${rule.maxLockMs}::float8)`;

    const [row] = await this.db
      .insert(authThrottle)
      .values({
        key,
        failures: initial.failures,
        windowStartedAt: initial.windowStartedAt,
        lockedUntil: initial.lockedUntil,
        lockoutCount: initial.lockoutCount,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: authThrottle.key,
        // Locked at `now`: leave the row alone (attempts that raced past the pre-check).
        setWhere: sql`(${authThrottle.lockedUntil} IS NULL OR ${authThrottle.lockedUntil} <= ${nowSql})`,
        set: {
          failures: sql`(CASE WHEN ${locks} THEN 0 ELSE ${nextFailures} END)`,
          windowStartedAt: sql`(CASE WHEN ${locks} OR ${windowExpired} THEN ${nowSql} ELSE ${authThrottle.windowStartedAt} END)`,
          lockedUntil: sql`(CASE WHEN ${locks} THEN ${nowSql} + ${lockMs} * interval '1 millisecond' ELSE NULL END)`,
          lockoutCount: sql`(CASE WHEN ${locks} THEN ${authThrottle.lockoutCount} + 1 ELSE ${authThrottle.lockoutCount} END)`,
          updatedAt: now,
        },
      })
      .returning();

    if (row !== undefined) {
      // Only rows that were inserted or updated come back, and both paths set `locked_until` only when
      // this very failure started the lockout.
      return { state: toState(row), lockedNow: row.lockedUntil !== null };
    }
    // Already locked: nothing changed. Report the row as it is (`applyFailure` returns it unchanged too).
    const current = await this.find(key);
    return { state: current ?? initial, lockedNow: false };
  }

  /**
   * Counts events of a key in a FIXED window (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, one
   * statement, concurrency safe). Used for the installation-wide failed-login budget. The row is
   * never locked; idle rows are removed by `purgeStale`.
   */
  async bumpWindow(key: string, now: Date, windowMs: number): Promise<{ count: number; windowStartedAt: Date }> {
    const nowSql = sql`${now.toISOString()}::timestamptz`;
    const expired = sql`(${nowSql} - ${authThrottle.windowStartedAt} >= ${windowMs}::float8 * interval '1 millisecond')`;
    const [row] = await this.db
      .insert(authThrottle)
      .values({ key, failures: 1, windowStartedAt: now, lockedUntil: null, lockoutCount: 0, updatedAt: now })
      .onConflictDoUpdate({
        target: authThrottle.key,
        set: {
          failures: sql`(CASE WHEN ${expired} THEN 1 ELSE ${authThrottle.failures} + 1 END)`,
          windowStartedAt: sql`(CASE WHEN ${expired} THEN ${nowSql} ELSE ${authThrottle.windowStartedAt} END)`,
          updatedAt: now,
        },
      })
      .returning({ count: authThrottle.failures, windowStartedAt: authThrottle.windowStartedAt });
    if (row === undefined) throw new Error('auth_throttle upsert returned no row');
    return row;
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
