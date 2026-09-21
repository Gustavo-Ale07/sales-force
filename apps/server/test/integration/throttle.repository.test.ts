import { authThrottle } from '@salesforce/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyFailure, type ThrottleRule, type ThrottleState } from '../../src/iam/throttle-policy.js';
import { ThrottleRepository } from '../../src/iam/throttle.repository.js';
import { createMigratedDatabase, startPostgres, type TestPostgres } from '../helpers/postgres.js';

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];

beforeAll(async () => {
  postgres = await startPostgres();
});

afterAll(async () => {
  for (const close of opened.reverse()) await close();
  await postgres.stop();
});

async function repository() {
  const database = await createMigratedDatabase(postgres);
  opened.push(() => database.handle.close());
  return { database, repo: new ThrottleRepository(database.handle.db) };
}

const RULE: ThrottleRule = { maxFailures: 3, windowMs: 1000, baseLockMs: 500, maxLockMs: 4000 };
const T0 = new Date('2026-09-21T12:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

describe('ThrottleRepository.recordFailure (A1: atomic single-statement counter)', () => {
  it('is one statement on the pool: no explicit transaction (a transaction checks out a client itself)', async () => {
    const { database, repo } = await repository();
    const connect = vi.spyOn(database.handle.pool, 'connect');
    const query = vi.spyOn(database.handle.pool, 'query');
    await repo.recordFailure('k:single', T0, RULE);
    expect(connect.mock.calls.length).toBeLessThanOrEqual(1); // pg-pool.query() checks out internally
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('never loses an increment under concurrency', async () => {
    const { repo } = await repository();
    const rule: ThrottleRule = { ...RULE, maxFailures: 1000, windowMs: 60_000 };
    await Promise.all(Array.from({ length: 40 }, () => repo.recordFailure('k:concurrent', T0, rule)));
    expect((await repo.find('k:concurrent'))?.failures).toBe(40);
  });

  it('starts exactly one lockout when concurrent failures cross the limit', async () => {
    const { repo } = await repository();
    const rule: ThrottleRule = { ...RULE, maxFailures: 5, windowMs: 60_000, baseLockMs: 60_000, maxLockMs: 60_000 };
    const outcomes = await Promise.all(Array.from({ length: 12 }, () => repo.recordFailure('k:lockrace', T0, rule)));
    expect(outcomes.filter((outcome) => outcome.lockedNow)).toHaveLength(1);
    const state = await repo.find('k:lockrace');
    expect(state?.lockoutCount).toBe(1);
    expect(state?.lockedUntil?.getTime()).toBe(T0.getTime() + 60_000);
  });

  it('matches the pure applyFailure step by step (window expiry, lock, doubling, attempts while locked)', async () => {
    const { repo } = await repository();
    let expected: ThrottleState | null = null;
    // Times in ms after T0: inside a window, past it, into a lock, past the lock, a second lock, the cap.
    const times = [0, 100, 200, 300, 400, 900, 1000, 1200, 1300, 1400, 2500, 2600, 2700, 3300, 3400, 3500, 9000, 9100, 9200, 15_000, 15_100, 15_200];
    for (const ms of times) {
      const outcome = applyFailure(expected, at(ms), RULE);
      const actual = await repo.recordFailure('k:oracle', at(ms), RULE);
      expect(actual.lockedNow, `lockedNow at +${ms}`).toBe(outcome.lockedNow);
      expect(actual.state, `state at +${ms}`).toEqual(outcome.state);
      expected = outcome.state;
    }
    expect(expected?.lockoutCount).toBeGreaterThanOrEqual(3);
  });
});

describe('ThrottleRepository.bumpWindow (A1: global failure budget counter)', () => {
  it('counts inside a fixed window and restarts when the window ends, atomically', async () => {
    const { database, repo } = await repository();
    const counts = await Promise.all(Array.from({ length: 10 }, () => repo.bumpWindow('global:test', T0, 60_000)));
    expect([...counts.map((c) => c.count)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect((await repo.bumpWindow('global:test', at(59_000), 60_000)).count).toBe(11);
    const next = await repo.bumpWindow('global:test', at(60_000), 60_000);
    expect(next.count).toBe(1);
    expect(next.windowStartedAt.getTime()).toBe(at(60_000).getTime());
    const [row] = await database.handle.db.select().from(authThrottle).where(eq(authThrottle.key, 'global:test'));
    expect(row?.lockedUntil).toBeNull();
  });
});
