import { describe, expect, it } from 'vitest';
import {
  discountExceedsLimit,
  indexSellerDiscountRules,
  resolveSellerDiscountLimit,
  type SellerDiscountRule,
} from '../src/index.js';

// Tree: 10 (pai) > 11 (filho) > 111 (neto); 20 (outro pai) > 21.
const PARENTS = new Map<number, number | null>([
  [10, null],
  [11, 10],
  [111, 11],
  [20, null],
  [21, 20],
]);
const parentOf = (code: number): number | null => PARENTS.get(code) ?? null;

const resolve = (rules: readonly SellerDiscountRule[], product = { productCode: 500, groupCode: 111 as number | null }, erpMaxPercent: string | null = null) =>
  resolveSellerDiscountLimit({ ...product, erpMaxPercent, rules: indexSellerDiscountRules(rules), parentOf });

describe('resolveSellerDiscountLimit', () => {
  it('product rule wins over every other level', () => {
    const rules: SellerDiscountRule[] = [
      { kind: 'product', code: 500, percent: '3' },
      { kind: 'group', code: 111, percent: '5' },
      { kind: 'group', code: 10, percent: '7' },
      { kind: 'general', code: null, percent: '9' },
    ];
    expect(resolve(rules, undefined, '20')).toEqual({ limit: '3', source: 'product' });
  });

  it('child group wins over parent group, general and erp', () => {
    const rules: SellerDiscountRule[] = [
      { kind: 'group', code: 11, percent: '5' },
      { kind: 'group', code: 10, percent: '7' },
      { kind: 'general', code: null, percent: '9' },
    ];
    expect(resolve(rules, undefined, '20')).toEqual({ limit: '5', source: 'group', groupCode: 11 });
  });

  it('inherits the parent group rule through three levels', () => {
    const rules: SellerDiscountRule[] = [{ kind: 'group', code: 10, percent: '7' }];
    expect(resolve(rules)).toEqual({ limit: '7', source: 'group', groupCode: 10 });
    expect(resolve(rules, { productCode: 1, groupCode: 11 })).toEqual({ limit: '7', source: 'group', groupCode: 10 });
  });

  it('the nearest ancestor with a rule wins', () => {
    const rules: SellerDiscountRule[] = [
      { kind: 'group', code: 10, percent: '7' },
      { kind: 'group', code: 11, percent: '4' },
    ];
    expect(resolve(rules)).toEqual({ limit: '4', source: 'group', groupCode: 11 });
  });

  it('a rule of an unrelated group is ignored; general applies', () => {
    const rules: SellerDiscountRule[] = [
      { kind: 'group', code: 20, percent: '1' },
      { kind: 'general', code: null, percent: '9' },
    ];
    expect(resolve(rules)).toEqual({ limit: '9', source: 'general' });
  });

  it('falls back to the product DESCMAX, then to no limit', () => {
    expect(resolve([], undefined, '12.5')).toEqual({ limit: '12.5', source: 'erp_product' });
    expect(resolve([])).toEqual({ limit: null, source: 'none' });
    expect(resolve([], undefined, '')).toEqual({ limit: null, source: 'none' });
  });

  it('a zero rule is a real limit (no discount allowed), not absence', () => {
    expect(resolve([{ kind: 'product', code: 500, percent: '0' }], undefined, '20')).toEqual({ limit: '0', source: 'product' });
  });

  it('a product without group skips the group levels', () => {
    const rules: SellerDiscountRule[] = [
      { kind: 'group', code: 10, percent: '7' },
      { kind: 'general', code: null, percent: '9' },
    ];
    expect(resolve(rules, { productCode: 1, groupCode: null })).toEqual({ limit: '9', source: 'general' });
  });

  it('survives a cycle in the group tree', () => {
    const cyclic = new Map<number, number | null>([[1, 2], [2, 1]]);
    const out = resolveSellerDiscountLimit({
      productCode: 9,
      groupCode: 1,
      erpMaxPercent: null,
      rules: indexSellerDiscountRules([{ kind: 'general', code: null, percent: '4' }]),
      parentOf: (code) => cyclic.get(code) ?? null,
    });
    expect(out).toEqual({ limit: '4', source: 'general' });
  });
});

describe('discountExceedsLimit', () => {
  it('is strictly above the limit; no limit never exceeds', () => {
    expect(discountExceedsLimit('5', '5')).toBe(false);
    expect(discountExceedsLimit('5.01', '5')).toBe(true);
    expect(discountExceedsLimit('50', null)).toBe(false);
    expect(discountExceedsLimit('0.01', '0')).toBe(true);
  });
});
