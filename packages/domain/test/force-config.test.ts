import { describe, expect, it } from 'vitest';
import { resolveForceConfig } from '../src/index.js';

describe('resolveForceConfig (Force own configuration)', () => {
  it('defaults when there is no row or the fields are empty', () => {
    expect(resolveForceConfig(null)).toEqual({ daysWithoutSync: 7, defaultPriceTableCode: 5 });
    expect(resolveForceConfig({ maxDaysWithoutSync: null, defaultPriceTableCode: null })).toEqual({ daysWithoutSync: 7, defaultPriceTableCode: 5 });
  });
  it('uses the stored values; table 0 is valid', () => {
    expect(resolveForceConfig({ maxDaysWithoutSync: 3, defaultPriceTableCode: 0 })).toEqual({ daysWithoutSync: 3, defaultPriceTableCode: 0 });
    expect(resolveForceConfig({ maxDaysWithoutSync: 60, defaultPriceTableCode: 9 })).toEqual({ daysWithoutSync: 60, defaultPriceTableCode: 9 });
  });
  it('invalid or out-of-range values fall back', () => {
    expect(resolveForceConfig({ maxDaysWithoutSync: 0, defaultPriceTableCode: -1 })).toEqual({ daysWithoutSync: 7, defaultPriceTableCode: 5 });
    expect(resolveForceConfig({ maxDaysWithoutSync: 61, defaultPriceTableCode: 1.5 })).toEqual({ daysWithoutSync: 7, defaultPriceTableCode: 5 });
  });
});
