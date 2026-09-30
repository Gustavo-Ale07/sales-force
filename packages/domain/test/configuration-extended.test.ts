import { describe, expect, it } from 'vitest';
import { defaultUnconfiguredConfiguration, validateConfigurationConsistency } from '../src/index.js';
import { makeConfig } from './fixtures.js';

// Synthetic values only (no customer literals).
describe('extended configuration (optional blocks)', () => {
  const codesOf = (cfg: ReturnType<typeof makeConfig>) =>
    validateConfigurationConsistency(cfg).map((i) => `${i.code}@${i.path}`);

  it('keeps the unconfigured default free of the new fields', () => {
    const c = defaultUnconfiguredConfiguration();
    expect(c.sales.eligibleOrderTopCodes).toBeUndefined();
    expect(c.sales.orderStockLocationCode).toBeUndefined();
    expect(c.sales.orderLayout).toBeUndefined();
    expect(c.general.defaultCompanyCode).toBeUndefined();
    expect(c.products.mobilityFilter).toBeUndefined();
    expect(c.pricing.mobilePriceTableCodes).toBeUndefined();
    expect(c.pricing.alternativeTable).toBeUndefined();
  });

  it('accepts a coherent real-shaped configuration', () => {
    const cfg = makeConfig((c) => ({
      ...c,
      general: { ...c.general, defaultCompanyCode: 77 },
      sales: {
        ...c.sales,
        eligibleOrderTopCodes: [4100, 4101, 4150],
        orderStockLocationCode: 12,
        orderLayout: {
          layoutNumber: 7,
          fieldSupport: {
            header: { FIELD_A: 'SUPPORTED', FIELD_B: 'READ_ONLY' },
            items: { FIELD_C: 'SUPPORTED' },
            unlistedFields: 'IGNORED_UNTIL_NEEDED',
          },
        },
      },
      products: {
        ...c.products,
        mobilityFilter: {
          sourceField: 'AD_FLAG',
          allowedValues: ['Y'],
          validation: 'pending_validation',
          mode: 'disabled',
        },
      },
      pricing: {
        ...c.pricing,
        fallbackStrategy: 'fixed_table',
        fallbackTableCode: 88,
        catalogReferenceTableCode: 3,
        mobilePriceTableCodes: [3, 5, 88],
        alternativeTable: { tableCode: 5, validation: 'needs_validation', active: false },
      },
    }));
    expect(codesOf(cfg)).toEqual([]);
  });

  it('requires orderTopCode to be eligible and eligible codes to be unique', () => {
    const notIn = makeConfig((c) => ({
      ...c,
      sales: { ...c.sales, eligibleOrderTopCodes: [1, 2] },
    }));
    expect(codesOf(notIn)).toEqual(['order_top_not_eligible@sales.orderTopCode']);
    const dup = makeConfig((c) => ({
      ...c,
      sales: { ...c.sales, eligibleOrderTopCodes: [4101, 4101] },
    }));
    expect(codesOf(dup)).toEqual(['duplicate_eligible_order_top@sales.eligibleOrderTopCodes']);
  });

  it('requires defaultCompanyCode to be an enabled company', () => {
    const cfg = makeConfig((c) => ({ ...c, general: { ...c.general, defaultCompanyCode: 1 } }));
    expect(codesOf(cfg)).toEqual(['default_company_not_enabled@general.defaultCompanyCode']);
    const nullOk = makeConfig((c) => ({
      ...c,
      general: { ...c.general, defaultCompanyCode: null },
    }));
    expect(codesOf(nullOk)).toEqual([]);
  });

  it('never allows an enforced mobility filter that is not validated', () => {
    const mk = (validation: 'pending_validation' | 'validated', mode: 'disabled' | 'enforced') =>
      makeConfig((c) => ({
        ...c,
        products: {
          ...c.products,
          mobilityFilter: { sourceField: 'AD_FLAG', allowedValues: ['Y'], validation, mode },
        },
      }));
    expect(codesOf(mk('pending_validation', 'enforced'))).toEqual([
      'mobility_filter_enforced_unvalidated@products.mobilityFilter.mode',
    ]);
    expect(codesOf(mk('validated', 'enforced'))).toEqual([]);
    expect(codesOf(mk('pending_validation', 'disabled'))).toEqual([]);
  });

  it('checks mobile price table list rules', () => {
    const withPricing = (pricing: Partial<ReturnType<typeof makeConfig>['pricing']>) =>
      makeConfig((c) => ({ ...c, pricing: { ...c.pricing, ...pricing } }));
    expect(codesOf(withPricing({ mobilePriceTableCodes: [1, 1] }))).toEqual([
      'duplicate_mobile_price_table@pricing.mobilePriceTableCodes',
    ]);
    expect(
      codesOf(
        withPricing({
          fallbackStrategy: 'fixed_table',
          fallbackTableCode: 9,
          mobilePriceTableCodes: [1],
        }),
      ),
    ).toEqual(['fallback_table_not_mobile@pricing.fallbackTableCode']);
    expect(
      codesOf(withPricing({ catalogReferenceTableCode: 9, mobilePriceTableCodes: [1] })),
    ).toEqual(['catalog_reference_table_not_mobile@pricing.catalogReferenceTableCode']);
    expect(codesOf(withPricing({ catalogReferenceTableCode: 9 }))).toEqual([]);
  });

  it('never activates an alternative table that is not validated', () => {
    const mk = (validation: 'needs_validation' | 'validated', active: boolean) =>
      makeConfig((c) => ({
        ...c,
        pricing: { ...c.pricing, alternativeTable: { tableCode: 5, validation, active } },
      }));
    expect(codesOf(mk('needs_validation', true))).toEqual([
      'alternative_table_active_unvalidated@pricing.alternativeTable.active',
    ]);
    expect(codesOf(mk('needs_validation', false))).toEqual([]);
    expect(codesOf(mk('validated', true))).toEqual([]);
  });
});
