import { describe, expect, it } from 'vitest';
import {
  defaultUnconfiguredConfiguration,
  findEffectiveVersion,
  isLineOrderable,
  isProductSellable,
  isProductVisible,
  resolveCustomerPriceTable,
  resolveListPrice,
  type InstallationConfiguration,
  type ListPrice,
} from '../src/index.js';
import { makeConfig, makeCustomer, makePriceLookup, makeProduct, makeVersion } from './fixtures.js';

describe('isProductSellable (driven purely by configuration)', () => {
  const config = makeConfig();

  it('is sellable when active and usage code is configured', () => {
    expect(isProductSellable(makeProduct({ usageCode: 'Q1' }), config)).toBe(true);
    expect(isProductSellable(makeProduct({ usageCode: 'Q2' }), config)).toBe(true);
  });

  it.each([
    ['unlisted usage', { usageCode: 'Z9' }],
    ['null usage', { usageCode: null }],
    ['inactive', { active: false }],
    ['case differs', { usageCode: 'q1' }],
  ])('is not sellable: %s', (_label, patch) => {
    expect(isProductSellable(makeProduct(patch), config)).toBe(false);
  });

  it('changes with configuration alone, for the same product', () => {
    const product = makeProduct({ usageCode: 'Z9' });
    expect(isProductSellable(product, config)).toBe(false);
    const widened = makeConfig((c) => ({
      ...c,
      products: { ...c.products, sellableUsageValues: ['Z9'] },
    }));
    expect(isProductSellable(product, widened)).toBe(true);
  });

  it('nothing is sellable in the unconfigured default', () => {
    const unconfigured = defaultUnconfiguredConfiguration();
    expect(unconfigured.general.enabled).toBe(false);
    expect(isProductSellable(makeProduct(), unconfigured)).toBe(false);
  });

  it('nothing is sellable when the installation is disabled, even with usage values', () => {
    const disabled = makeConfig((c) => ({ ...c, general: { ...c.general, enabled: false } }));
    expect(isProductSellable(makeProduct(), disabled)).toBe(false);
  });

  it('nothing is sellable with an empty usage list', () => {
    const empty = makeConfig((c) => ({ ...c, products: { ...c.products, sellableUsageValues: [] } }));
    expect(isProductSellable(makeProduct(), empty)).toBe(false);
  });
});

describe('isProductVisible', () => {
  const base = makeConfig();
  const withProducts = (patch: Partial<InstallationConfiguration['products']>): InstallationConfiguration => ({
    ...base,
    products: { ...base.products, ...patch },
  });

  it.each([
    ['active priced', true, 'priced', {}, true],
    ['inactive hidden by default', false, 'priced', {}, false],
    ['inactive shown when configured', false, 'priced', { showInactive: true }, true],
    ['no price hidden by default', true, 'none', {}, false],
    ['zero price hidden by default', true, 'zero', {}, false],
    [
      'no price shown when configured',
      true,
      'none',
      { productWithoutPrice: { visible: true, orderable: false } },
      true,
    ],
  ] as const)('%s', (_label, active, state, patch, expected) => {
    expect(isProductVisible(makeProduct({ active }), withProducts(patch), state)).toBe(expected);
  });
});

describe('resolveCustomerPriceTable', () => {
  const withFallback = (
    policy: InstallationConfiguration['customers']['customerWithoutPriceTable'],
    strategy: InstallationConfiguration['pricing']['fallbackStrategy'],
    table: number | null,
  ): InstallationConfiguration =>
    makeConfig((c) => ({
      ...c,
      customers: { ...c.customers, customerWithoutPriceTable: policy },
      pricing: { ...c.pricing, fallbackStrategy: strategy, fallbackTableCode: table },
    }));

  it('uses the customer table when present, regardless of fallback settings', () => {
    expect(
      resolveCustomerPriceTable(makeCustomer({ priceTableCode: 88 }), withFallback('use_fallback_table', 'fixed_table', 99)),
    ).toEqual({ kind: 'table', code: 88, source: 'customer' });
  });

  it.each([
    ['policy no_resolved_table', withFallback('no_resolved_table', 'fixed_table', 99)],
    ['strategy none', withFallback('use_fallback_table', 'none', null)],
    ['fixed_table without a code', withFallback('use_fallback_table', 'fixed_table', null)],
    ['unconfigured default', defaultUnconfiguredConfiguration()],
  ])('null customer table without usable fallback -> no_resolved_table (%s)', (_label, config) => {
    expect(resolveCustomerPriceTable(makeCustomer({ priceTableCode: null }), config)).toEqual({
      kind: 'no_resolved_table',
    });
  });

  it('null customer table with a configured fallback -> fallback table', () => {
    expect(
      resolveCustomerPriceTable(makeCustomer({ priceTableCode: null }), withFallback('use_fallback_table', 'fixed_table', 99)),
    ).toEqual({ kind: 'table', code: 99, source: 'fallback' });
  });

  it('table code 0 is a real table, not "missing"', () => {
    expect(
      resolveCustomerPriceTable(makeCustomer({ priceTableCode: 0 }), makeConfig()),
    ).toEqual({ kind: 'table', code: 0, source: 'customer' });
  });
});

describe('findEffectiveVersion', () => {
  const versions = [
    makeVersion({ versionId: 1, tableCode: 88, effectiveFrom: '2030-01-01T00:00:00.000Z' }),
    makeVersion({ versionId: 2, tableCode: 88, effectiveFrom: '2030-02-01T00:00:00.000Z' }),
    makeVersion({ versionId: 3, tableCode: 88, effectiveFrom: '2030-03-01T00:00:00.000Z' }),
    makeVersion({ versionId: 4, tableCode: 99, effectiveFrom: '2030-02-15T00:00:00.000Z' }),
  ];

  it.each([
    ['2029-12-31T23:59:59.000Z', null],
    ['2030-01-01T00:00:00.000Z', 1],
    ['2030-02-10T00:00:00.000Z', 2],
    ['2030-02-01T00:00:00.000Z', 2],
    ['2031-01-01T00:00:00.000Z', 3],
  ])('at %s -> version %s', (at, expected) => {
    expect(findEffectiveVersion(88, versions, at)?.versionId ?? null).toBe(expected);
  });

  it('ignores other tables', () => {
    expect(findEffectiveVersion(99, versions, '2030-02-10T00:00:00.000Z')).toBeNull();
    expect(findEffectiveVersion(99, versions, '2030-02-16T00:00:00.000Z')?.versionId).toBe(4);
  });

  it('breaks ties on the same instant by the higher version id', () => {
    const tied = [
      makeVersion({ versionId: 7, effectiveFrom: '2030-01-01T00:00:00.000Z' }),
      makeVersion({ versionId: 9, effectiveFrom: '2030-01-01T00:00:00.000Z' }),
      makeVersion({ versionId: 8, effectiveFrom: '2030-01-01T00:00:00.000Z' }),
    ];
    expect(findEffectiveVersion(88, tied, '2030-06-01T00:00:00.000Z')?.versionId).toBe(9);
  });

  it('rejects an invalid instant', () => {
    expect(() => findEffectiveVersion(88, versions, 'not-a-date')).toThrow(RangeError);
  });
});

describe('resolveListPrice: priced vs zero vs none', () => {
  const versions = [
    makeVersion({ versionId: 1, effectiveFrom: '2030-01-01T00:00:00.000Z' }),
    makeVersion({ versionId: 2, effectiveFrom: '2030-02-01T00:00:00.000Z' }),
  ];
  const rows: ListPrice[] = [
    { versionId: 1, productCode: 3001, unitPrice: '5.000000' },
    { versionId: 2, productCode: 3001, unitPrice: '12.340000' },
    { versionId: 2, productCode: 3002, unitPrice: '0.000000' },
  ];
  const table = { kind: 'table', code: 88, source: 'customer' } as const;
  const resolve = (productCode: number, at: string, tbl: Parameters<typeof resolveListPrice>[0]['table'] = table) =>
    resolveListPrice({ productCode, table: tbl, versions, findPrice: makePriceLookup(rows), at });

  it('priced: uses the effective version', () => {
    expect(resolve(3001, '2030-02-15T00:00:00.000Z')).toEqual({
      state: 'priced',
      unitPrice: '12.34',
      tableCode: 88,
      versionId: 2,
    });
    expect(resolve(3001, '2030-01-15T00:00:00.000Z')).toMatchObject({ state: 'priced', unitPrice: '5', versionId: 1 });
  });

  it('zero: an explicit zero row is zero, not none', () => {
    expect(resolve(3002, '2030-02-15T00:00:00.000Z')).toEqual({
      state: 'zero',
      unitPrice: '0',
      tableCode: 88,
      versionId: 2,
    });
  });

  it('none: no row in the effective version (an older version row is not used)', () => {
    expect(resolve(3002, '2030-01-15T00:00:00.000Z')).toEqual({
      state: 'none',
      reason: 'no_price_row',
      tableCode: 88,
      versionId: 1,
    });
    expect(resolve(9999, '2030-02-15T00:00:00.000Z')).toMatchObject({ state: 'none', reason: 'no_price_row' });
  });

  it('none: no effective version yet', () => {
    expect(resolve(3001, '2029-01-01T00:00:00.000Z')).toEqual({
      state: 'none',
      reason: 'no_effective_version',
      tableCode: 88,
      versionId: null,
    });
  });

  it('none: no resolved table', () => {
    expect(resolve(3001, '2030-02-15T00:00:00.000Z', { kind: 'no_resolved_table' })).toEqual({
      state: 'none',
      reason: 'no_resolved_table',
      tableCode: null,
      versionId: null,
    });
  });

  it('never turns a missing price into a zero price', () => {
    const missing = resolve(9999, '2030-02-15T00:00:00.000Z');
    expect(missing.state).toBe('none');
    expect('unitPrice' in missing).toBe(false);
  });

  it('throws on corrupt mirrored prices', () => {
    expect(() =>
      resolveListPrice({
        productCode: 1,
        table,
        versions,
        findPrice: () => ({ versionId: 2, productCode: 1, unitPrice: '-1' }),
        at: '2030-02-15T00:00:00.000Z',
      }),
    ).toThrow(RangeError);
  });
});

describe('isLineOrderable', () => {
  const cfg = (allowDraftWithoutPrice: boolean, orderable: boolean): InstallationConfiguration =>
    makeConfig((c) => ({
      ...c,
      sales: { ...c.sales, orderBehavior: { allowDraftWithoutPrice } },
      products: { ...c.products, productWithoutPrice: { visible: true, orderable } },
    }));

  it.each([
    ['priced', false, false, true],
    ['priced', true, true, true],
    ['none', false, false, false],
    ['none', true, false, false],
    ['none', false, true, false],
    ['none', true, true, true],
    ['zero', false, false, false],
    ['zero', true, true, true],
  ] as const)('%s with allowDraft=%s orderable=%s -> %s', (state, allow, orderable, expected) => {
    expect(isLineOrderable(state, cfg(allow, orderable))).toBe(expected);
  });

  it('unconfigured default: nothing without a price is orderable', () => {
    const d = defaultUnconfiguredConfiguration();
    expect(isLineOrderable('none', d)).toBe(false);
    expect(isLineOrderable('zero', d)).toBe(false);
  });
});
