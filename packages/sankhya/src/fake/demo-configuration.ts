import type { InstallationConfiguration } from '@salesforce/domain';
import { DEMO_ACCOUNT_EMAILS } from './accounts.js';

/**
 * Fixture seller codes referenced by the demo configuration (must exist in the demo dataset).
 * All values in this file are SYNTHETIC and deliberately different from any real installation
 * (CFG-6): a hard-coded value from a real customer would show up as a bug in demo data.
 */
export const DEMO_MANAGER_SELLER_CODE = 101;
export const DEMO_SELLER_A_CODE = 103;
export const DEMO_SELLER_B_CODE = 107;

/** Price tables of the demo dataset. The fallback table is used by no customer as its own table. */
export const DEMO_MAIN_TABLE_CODE = 21;
export const DEMO_DERIVED_TABLE_CODE = 22;
export const DEMO_FALLBACK_TABLE_CODE = 23;

export const DEMO_CONFIGURATION_SYNCED_AT = '2026-09-18T00:00:00.000Z';

export const DEMO_CONFIGURATION: InstallationConfiguration = deepFreeze({
  schemaVersion: 1,
  source: { kind: 'demo', version: 'demo-1', syncedAt: DEMO_CONFIGURATION_SYNCED_AT },
  general: { enabled: true, enabledCompanyCodes: [10] },
  sales: {
    orderTopCode: 9000,
    quotationTopCode: 9001,
    defaultNegotiationTypeCode: 2,
    negotiationTypes: [
      { code: 2, label: 'À vista (demonstração)' },
      { code: 3, label: '28 dias (demonstração)' },
    ],
    orderBehavior: { allowDraftWithoutPrice: false },
    // ERP order submission stays disabled until its write-safety gates close (SNK-6).
    confirmationBehavior: 'disabled',
  },
  customers: {
    portfolioOwnership: { strategy: 'explicit_account_links' },
    accountSellerLinks: [
      { accountEmail: DEMO_ACCOUNT_EMAILS.manager, sellerCode: DEMO_MANAGER_SELLER_CODE },
      { accountEmail: DEMO_ACCOUNT_EMAILS.seller1, sellerCode: DEMO_SELLER_A_CODE },
      { accountEmail: DEMO_ACCOUNT_EMAILS.seller2, sellerCode: DEMO_SELLER_B_CODE },
    ],
    customerWithoutPriceTable: 'use_fallback_table',
    creditFeatures: { showCreditLimit: true },
  },
  products: {
    sellableUsageValues: ['A', 'B'],
    showInactive: false,
    productWithoutPrice: { visible: true, orderable: false },
  },
  pricing: {
    customerTableStrategy: 'customer_table',
    fallbackStrategy: 'fixed_table',
    fallbackTableCode: DEMO_FALLBACK_TABLE_CODE,
    catalogReferenceTableCode: DEMO_MAIN_TABLE_CODE,
    missingPrice: 'no_price_state',
  },
  financial: { showFinancialArea: false, overdueTitles: false, creditChecks: false },
  features: { demoMetrics: true },
} satisfies InstallationConfiguration);

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
