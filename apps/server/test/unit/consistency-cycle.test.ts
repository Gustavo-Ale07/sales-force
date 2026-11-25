import { describe, expect, it, vi } from 'vitest';
import { diffKeyed } from '../../src/consistency/compare.js';
import { ConsistencyCycle, isConsistencyCheckEnabled } from '../../src/consistency/consistency-cycle.js';
import { createLogger } from '../../src/observability/logger.js';

const logger = createLogger({ level: 'silent', service: 'worker' });

describe('diffKeyed', () => {
  it('missing, extra, divergent, consistent; soft-deleted rows are not live', () => {
    const source = new Map([['1', 'a'], ['2', 'b'], ['3', 'c']]);
    const mirror = new Map([
      ['1', { hash: 'a', deleted: false }],
      ['2', { hash: 'x', deleted: false }],
      ['3', { hash: 'c', deleted: true }],
      ['4', { hash: 'd', deleted: false }],
      ['5', { hash: 'e', deleted: true }],
    ]);
    expect(diffKeyed(source, mirror)).toEqual({ missing: ['3'], extra: ['4'], divergent: ['2'] });
    expect(diffKeyed(new Map([['1', 'a']]), new Map([['1', { hash: 'a', deleted: false }]]))).toEqual({ missing: [], extra: [], divergent: [] });
  });
});

describe('CONSISTENCY_CHECK_ENABLED', () => {
  it('is off unless explicitly opened', () => {
    expect(isConsistencyCheckEnabled({})).toBe(false);
    expect(isConsistencyCheckEnabled({ CONSISTENCY_CHECK_ENABLED: '0' })).toBe(false);
    expect(isConsistencyCheckEnabled({ CONSISTENCY_CHECK_ENABLED: 'true' })).toBe(true);
    expect(isConsistencyCheckEnabled({ CONSISTENCY_CHECK_ENABLED: '1' })).toBe(true);
  });
});

describe('ConsistencyCycle', () => {
  it('runs at most once per 10 minutes, never overlaps, skips on a tight budget and swallows failures', async () => {
    let clock = 1_000_000;
    const run = vi.fn(async () => undefined as never);
    const cycle = new ConsistencyCycle({ verifier: { run }, logger, now: () => clock });
    expect(await cycle.afterSync()).toBe('ran');
    clock += 9 * 60_000;
    expect(await cycle.afterSync()).toBe('throttled');
    clock += 2 * 60_000;
    expect(await cycle.afterSync()).toBe('ran');
    expect(run).toHaveBeenCalledTimes(2);

    let release: () => void = () => undefined;
    const slow = new ConsistencyCycle({ verifier: { run: () => new Promise((resolve) => { release = () => resolve(undefined as never); }) }, logger, now: () => clock, minIntervalMs: 0 });
    const first = slow.afterSync();
    expect(await slow.afterSync()).toBe('in_flight');
    release();
    expect(await first).toBe('ran');

    const tight = new ConsistencyCycle({ verifier: { run }, logger, now: () => clock, budget: { used: 8, limit: 10, exhausted: false } });
    expect(await tight.afterSync()).toBe('budget_tight');

    const broken = new ConsistencyCycle({ verifier: { run: async () => { throw new Error('boom'); } }, logger, now: () => clock });
    expect(await broken.afterSync()).toBe('failed');
  });
});
