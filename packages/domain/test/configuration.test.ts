import { describe, expect, it } from 'vitest';
import {
  KNOWN_FEATURE_FLAGS,
  defaultUnconfiguredConfiguration,
  validateConfigurationConsistency,
} from '../src/index.js';
import { makeConfig } from './fixtures.js';

describe('defaultUnconfiguredConfiguration', () => {
  const config = defaultUnconfiguredConfiguration();

  it('is conservative', () => {
    expect(config.schemaVersion).toBe(1);
    expect(config.general).toEqual({ enabled: false, enabledCompanyCodes: [] });
    expect(config.products.sellableUsageValues).toEqual([]);
    expect(config.products.productWithoutPrice).toEqual({ visible: false, orderable: false });
    expect(config.sales.orderBehavior.allowDraftWithoutPrice).toBe(false);
    expect(config.sales.confirmationBehavior).toBe('disabled');
    expect(config.sales.orderTopCode).toBeNull();
    expect(config.sales.quotationTopCode).toBeNull();
    expect(config.sales.defaultNegotiationTypeCode).toBeNull();
    expect(config.pricing.fallbackStrategy).toBe('none');
    expect(config.pricing.fallbackTableCode).toBeNull();
    expect(config.pricing.missingPrice).toBe('no_price_state');
    expect(config.customers.customerWithoutPriceTable).toBe('no_resolved_table');
    expect(config.financial).toEqual({ showFinancialArea: false, overdueTitles: false, creditChecks: false });
    expect(config.features).toEqual({});
  });

  it('is itself consistent', () => {
    expect(validateConfigurationConsistency(config)).toEqual([]);
  });

  it('returns a fresh object each call (no shared mutable state)', () => {
    expect(defaultUnconfiguredConfiguration()).not.toBe(defaultUnconfiguredConfiguration());
    expect(defaultUnconfiguredConfiguration()).toEqual(defaultUnconfiguredConfiguration());
  });

  it('knows its feature flags', () => {
    expect(KNOWN_FEATURE_FLAGS).toContain('demoMetrics');
  });
});

describe('validateConfigurationConsistency', () => {
  it('accepts a coherent configuration', () => {
    expect(validateConfigurationConsistency(makeConfig())).toEqual([]);
  });

  it('requires a table code for fixed_table fallback', () => {
    const cfg = makeConfig((c) => ({
      ...c,
      pricing: { ...c.pricing, fallbackStrategy: 'fixed_table', fallbackTableCode: null },
    }));
    expect(validateConfigurationConsistency(cfg)).toEqual([
      { code: 'fallback_table_required', path: 'pricing.fallbackTableCode' },
    ]);
  });

  it('flags a fallback table when the strategy is none', () => {
    const cfg = makeConfig((c) => ({
      ...c,
      pricing: { ...c.pricing, fallbackStrategy: 'none', fallbackTableCode: 12 },
    }));
    expect(validateConfigurationConsistency(cfg).map((i) => i.code)).toEqual(['fallback_table_unexpected']);
  });

  it('flags an unknown default negotiation type and duplicates', () => {
    const cfg = makeConfig((c) => ({
      ...c,
      sales: {
        ...c.sales,
        defaultNegotiationTypeCode: 99,
        negotiationTypes: [
          { code: 31, label: 'A' },
          { code: 31, label: 'B' },
        ],
      },
    }));
    expect(validateConfigurationConsistency(cfg).map((i) => i.code).sort()).toEqual([
      'default_negotiation_type_unknown',
      'duplicate_negotiation_type',
    ]);
  });

  it('flags duplicate account-seller links (e-mail case-insensitive)', () => {
    const cfg = makeConfig((c) => ({
      ...c,
      customers: {
        ...c.customers,
        accountSellerLinks: [
          { accountEmail: 'a@example.test', sellerCode: 1 },
          { accountEmail: 'A@Example.test', sellerCode: 1 },
        ],
      },
    }));
    expect(validateConfigurationConsistency(cfg).map((i) => i.code)).toEqual(['duplicate_account_seller_link']);
  });
});
