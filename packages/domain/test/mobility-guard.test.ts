import { describe, expect, it } from 'vitest';
import { evaluateMobilityGuard, mobilityTally } from '../src/product-mobility.js';

describe('evaluateMobilityGuard (anti-empty-catalog, owner ruling 2026-11-13)', () => {
  it('a normal split is accepted', () => {
    expect(evaluateMobilityGuard({ visible: 1502, hidden: 192 })).toEqual({ keepPrevious: false, reason: null });
  });

  it('everything hidden keeps the previous base', () => {
    expect(evaluateMobilityGuard({ visible: 0, hidden: 40 })).toEqual({ keepPrevious: true, reason: 'all_hidden' });
  });

  it('a legitimately small enabled set is accepted, however large the hidden share (owner 2026-11-25: only all-hidden is guarded)', () => {
    expect(evaluateMobilityGuard({ visible: 4, hidden: 37 })).toEqual({ keepPrevious: false, reason: null });
    expect(evaluateMobilityGuard({ visible: 1, hidden: 999 })).toEqual({ keepPrevious: false, reason: null });
  });

  it('nothing read at all (0 + 0) is not a guard case: there is nothing to protect or hide', () => {
    expect(evaluateMobilityGuard({ visible: 0, hidden: 0 })).toEqual({ keepPrevious: false, reason: null });
  });

});

describe('mobilityTally', () => {
  it('counts S as visible; N, blank and null as hidden', () => {
    expect(mobilityTally([true, false, null, true, undefined])).toEqual({ visible: 2, hidden: 3 });
  });
});
