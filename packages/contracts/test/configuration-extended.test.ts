import { describe, expect, it } from 'vitest';
import { ConfigurationSummarySchema, InstallationConfigurationSchema } from '../src/index.js';
import { makeConfig } from './fixtures.js';

function issuesOf(input: unknown) {
  const result = InstallationConfigurationSchema.safeParse(input);
  return result.success ? [] : result.error.issues;
}
const ok = (input: unknown) => InstallationConfigurationSchema.safeParse(input).success;

describe('extended configuration fields (synthetic values)', () => {
  const extended = () =>
    makeConfig((c) => ({
      ...c,
      general: { ...c.general, defaultCompanyCode: 77 },
      sales: {
        ...c.sales,
        eligibleOrderTopCodes: [4100, 4101],
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
        mobilePriceTableCodes: [3, 5],
        alternativeTable: { tableCode: 5, validation: 'needs_validation', active: false },
      },
    }));

  it('accepts and round-trips a real-shaped configuration; old configs still parse', () => {
    const cfg = extended();
    expect(InstallationConfigurationSchema.parse(cfg)).toEqual(cfg);
    expect(ok(makeConfig())).toBe(true);
  });

  it('rejects unknown keys inside the new blocks', () => {
    const c = extended();
    const layout = c.sales.orderLayout!;
    const bad = [
      { ...c, sales: { ...c.sales, orderLayout: { ...layout, x: 1 } } },
      {
        ...c,
        sales: {
          ...c.sales,
          orderLayout: { ...layout, fieldSupport: { ...layout.fieldSupport, x: {} } },
        },
      },
      { ...c, products: { ...c.products, mobilityFilter: { ...c.products.mobilityFilter!, x: 1 } } },
      {
        ...c,
        pricing: { ...c.pricing, alternativeTable: { ...c.pricing.alternativeTable!, x: 1 } },
      },
    ];
    for (const b of bad) expect(ok(b)).toBe(false);
  });

  it('rejects invalid values', () => {
    const c = extended();
    const withFilter = (patch: object) => ({
      ...c,
      products: { ...c.products, mobilityFilter: { ...c.products.mobilityFilter!, ...patch } },
    });
    for (const sourceField of ['x; DROP', 'ad_flag', '1ABC', '', 'A'.repeat(31), 'A.B']) {
      expect(ok(withFilter({ sourceField }))).toBe(false);
    }
    expect(ok(withFilter({ allowedValues: [] }))).toBe(false);
    expect(ok(withFilter({ allowedValues: [''] }))).toBe(false);
    expect(ok(withFilter({ mode: 'on' }))).toBe(false);
    const withHeader = (header: object) => ({
      ...c,
      sales: {
        ...c.sales,
        orderLayout: {
          layoutNumber: 7,
          fieldSupport: { ...c.sales.orderLayout!.fieldSupport, header },
        },
      },
    });
    expect(ok(withHeader({ A: 'MAYBE' }))).toBe(false);
    expect(ok(withHeader({ ['A'.repeat(61)]: 'SUPPORTED' }))).toBe(false);
  });

  it('reports each consistency violation with code and path only', () => {
    const c = extended();
    const cases: Array<[unknown, string, string[]]> = [
      [
        { ...c, sales: { ...c.sales, eligibleOrderTopCodes: [1] } },
        'order_top_not_eligible',
        ['sales', 'orderTopCode'],
      ],
      [
        { ...c, general: { ...c.general, defaultCompanyCode: 1 } },
        'default_company_not_enabled',
        ['general', 'defaultCompanyCode'],
      ],
      [
        {
          ...c,
          products: {
            ...c.products,
            mobilityFilter: { ...c.products.mobilityFilter!, mode: 'enforced' },
          },
        },
        'mobility_filter_enforced_unvalidated',
        ['products', 'mobilityFilter', 'mode'],
      ],
      [
        {
          ...c,
          pricing: {
            ...c.pricing,
            alternativeTable: { tableCode: 5, validation: 'needs_validation', active: true },
          },
        },
        'alternative_table_active_unvalidated',
        ['pricing', 'alternativeTable', 'active'],
      ],
    ];
    for (const [input, code, path] of cases) {
      const issues = issuesOf(input);
      expect(issues.map((i) => i.message)).toEqual([code]);
      expect(issues[0]?.path).toEqual(path);
    }
  });

  it('flows through the client summary', () => {
    const { accountSellerLinks, ...rest } = extended().customers;
    const summary = {
      ...extended(),
      customers: { ...rest, accountSellerLinkCount: accountSellerLinks.length },
    };
    expect(ConfigurationSummarySchema.parse(summary)).toEqual(summary);
  });
});
