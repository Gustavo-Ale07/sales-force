import type { InstallationConfiguration } from '@salesforce/domain';

/**
 * A synthetic base file (`source.kind = bootstrap-file`) that the fake PLAC facts fixture overlays consistently
 * (company 1, TOPs 1000/1001/1051, negotiation types 1..35). Force-only keys present, bridge keys with older values.
 */
export function baseConfiguration(patch: (c: Record<string, any>) => void = () => undefined): InstallationConfiguration { // eslint-disable-line @typescript-eslint/no-explicit-any
  const config: Record<string, any> = { // eslint-disable-line @typescript-eslint/no-explicit-any
    schemaVersion: 1,
    source: { kind: 'bootstrap-file', version: 'base-2026-10-02', syncedAt: '2026-10-02T00:00:00.000Z' },
    general: { enabled: true, enabledCompanyCodes: [1], defaultCompanyCode: 1, appMinimumVersion: '1.0.0' },
    sales: {
      orderTopCode: 1001,
      eligibleOrderTopCodes: [1001],
      quotationTopCode: 1051,
      defaultNegotiationTypeCode: 2,
      negotiationTypes: Array.from({ length: 18 }, (_, i) => ({ code: i + 1, label: `antigo ${i + 1}` })),
      orderBehavior: { allowDraftWithoutPrice: false },
      topAllowlist: [1000, 1001],
      negotiationTypeExclusions: [23, 24],
      confirmationBehavior: 'disabled',
    },
    customers: {
      portfolioOwnership: { strategy: 'explicit_account_links' },
      accountSellerLinks: [],
      customerWithoutPriceTable: 'no_resolved_table',
      creditFeatures: { showCreditLimit: true },
    },
    products: { sellableUsageValues: ['A'], showInactive: false, productWithoutPrice: { visible: true, orderable: false } },
    pricing: {
      customerTableStrategy: 'customer_table',
      fallbackStrategy: 'none',
      fallbackTableCode: null,
      catalogReferenceTableCode: null,
      missingPrice: 'no_price_state',
      mobilePriceTableCodes: [5, 6, 7],
    },
    financial: { showFinancialArea: false, overdueTitles: false, creditChecks: false },
    features: {},
  };
  patch(config);
  return config as InstallationConfiguration;
}
