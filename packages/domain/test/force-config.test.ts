import { describe, expect, it } from 'vitest';
import {
  indexSellerDiscountRules,
  resolveForceConfig,
  resolveSellerDiscountLimit,
  sellerRulesFromErp,
  type ForceDiscountLimit,
} from '../src/index.js';

describe('resolveForceConfig', () => {
  it('defaults when the table is empty or the fields are empty', () => {
    expect(resolveForceConfig([])).toEqual({ daysWithoutSync: 7, defaultPriceTableCode: 5 });
    expect(resolveForceConfig([{ id: 1, daysWithoutSync: null, defaultPriceTableCode: null }])).toEqual({ daysWithoutSync: 7, defaultPriceTableCode: 5 });
  });
  it('uses the first row; invalid values fall back; table 0 is valid', () => {
    const rows = [
      { id: 2, daysWithoutSync: 30, defaultPriceTableCode: 9 },
      { id: 1, daysWithoutSync: 3, defaultPriceTableCode: 0 },
    ];
    expect(resolveForceConfig(rows)).toEqual({ daysWithoutSync: 3, defaultPriceTableCode: 0 });
    expect(resolveForceConfig([{ id: 1, daysWithoutSync: 0, defaultPriceTableCode: -1 }])).toEqual({ daysWithoutSync: 7, defaultPriceTableCode: 5 });
  });
});

const row = (seq: number, seller: number | null, group: number | null, product: number | null, percent: string): ForceDiscountLimit => ({
  configId: 1, seq, sellerCode: seller, groupCode: group, productCode: product, percent,
});

// Tree: 10 > 11 > 111.
const PARENTS = new Map<number, number | null>([[10, null], [11, 10], [111, 11]]);
const resolveFor = (seller: number, general: string | null, rows: ForceDiscountLimit[], erp: string | null, group = 111, product = 500) =>
  resolveSellerDiscountLimit({
    productCode: product,
    groupCode: group,
    erpMaxPercent: erp,
    rules: indexSellerDiscountRules(sellerRulesFromErp(seller, general, rows)),
    parentOf: (code) => PARENTS.get(code) ?? null,
  });

describe('sellerRulesFromErp + resolution chain', () => {
  const rows = [row(1, 7, null, 500, '3'), row(2, 7, 11, null, '5'), row(3, 7, 10, null, '8'), row(4, 8, null, 500, '1')];
  it('product > child group > parent group > seller ceiling > product ceiling > none', () => {
    expect(resolveFor(7, '9', rows, '20').source).toBe('product');
    expect(resolveFor(7, '9', rows, '20', 111, 501)).toEqual({ limit: '5', source: 'group', groupCode: 11 });
    expect(resolveFor(7, '9', [row(3, 7, 10, null, '8')], '20', 111, 501)).toEqual({ limit: '8', source: 'group', groupCode: 10 });
    expect(resolveFor(7, '9', [], '20', 111, 501)).toEqual({ limit: '9', source: 'general' });
    expect(resolveFor(7, null, [], '20', 111, 501)).toEqual({ limit: '20', source: 'erp_product' });
    expect(resolveFor(7, null, [], null, 111, 501)).toEqual({ limit: null, source: 'none' });
  });
  it('scope: only the seller own rows', () => {
    expect(sellerRulesFromErp(8, null, rows)).toEqual([{ kind: 'product', code: 500, percent: '1' }]);
    expect(sellerRulesFromErp(99, null, rows)).toEqual([]);
  });
  it('rows without product and group, or without seller, are not rules', () => {
    expect(sellerRulesFromErp(7, null, [row(1, 7, null, null, '4'), row(2, null, 10, null, '4')])).toEqual([]);
  });
});
