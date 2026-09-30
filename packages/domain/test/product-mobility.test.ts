import { describe, expect, it } from 'vitest';
import type { MobilityFilter } from '../src/configuration.js';
import { isProductMobilityAllowed } from '../src/product-mobility.js';

const filter = (over: Partial<MobilityFilter> = {}): MobilityFilter => ({
  sourceField: 'FIELD_X',
  allowedValues: ['Y'],
  validation: 'validated',
  mode: 'enforced',
  ...over,
});

describe('isProductMobilityAllowed', () => {
  it('no filter, or a disabled filter, never blocks (even unvalidated or with a missing code)', () => {
    expect(isProductMobilityAllowed({ mobilityCode: null }, undefined)).toBe(true);
    expect(isProductMobilityAllowed({}, filter({ mode: 'disabled', validation: 'pending_validation' }))).toBe(true);
  });

  it('an enforced, validated filter allows only the configured values', () => {
    expect(isProductMobilityAllowed({ mobilityCode: 'Y' }, filter())).toBe(true);
    expect(isProductMobilityAllowed({ mobilityCode: 'N' }, filter())).toBe(false);
  });

  it('blank or not-read mobility is blocked when enforced (never guessed visible)', () => {
    expect(isProductMobilityAllowed({ mobilityCode: null }, filter())).toBe(false);
    expect(isProductMobilityAllowed({}, filter())).toBe(false);
  });

  it('an enforced filter that is not validated is not enforced (fails open to the configured default: disabled semantics are explicit)', () => {
    expect(isProductMobilityAllowed({ mobilityCode: 'N' }, filter({ validation: 'pending_validation' }))).toBe(true);
  });
});
