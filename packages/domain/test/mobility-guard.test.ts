import { describe, expect, it } from 'vitest';
import { MOBILITY_HIDDEN_LIMIT_PERCENT, evaluateMobilityGuard, mobilityTally } from '../src/product-mobility.js';

describe('evaluateMobilityGuard (anti-empty-catalog, owner ruling 2026-11-13)', () => {
  it('a normal split is accepted', () => {
    expect(evaluateMobilityGuard({ visible: 1502, hidden: 192 })).toEqual({ keepPrevious: false, reason: null });
  });

  it('everything hidden keeps the previous base', () => {
    expect(evaluateMobilityGuard({ visible: 0, hidden: 40 })).toEqual({ keepPrevious: true, reason: 'all_hidden' });
  });

  it('more than 90 % hidden keeps the previous base', () => {
    expect(evaluateMobilityGuard({ visible: 9, hidden: 91 })).toEqual({ keepPrevious: true, reason: 'over_limit' });
  });

  it('exactly 90 % hidden is still accepted (the limit is exclusive)', () => {
    expect(evaluateMobilityGuard({ visible: 10, hidden: 90 })).toEqual({ keepPrevious: false, reason: null });
  });

  it('nothing read at all (0 + 0) is not a guard case: there is nothing to protect or hide', () => {
    expect(evaluateMobilityGuard({ visible: 0, hidden: 0 })).toEqual({ keepPrevious: false, reason: null });
  });

  it('the limit is the documented 90', () => {
    expect(MOBILITY_HIDDEN_LIMIT_PERCENT).toBe(90);
  });
});

describe('mobilityTally', () => {
  it('counts S as visible; N, blank and null as hidden', () => {
    expect(mobilityTally([true, false, null, true, undefined])).toEqual({ visible: 2, hidden: 3 });
  });
});
