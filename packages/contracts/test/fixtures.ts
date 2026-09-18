import { defaultUnconfiguredConfiguration } from '@salesforce/domain';
import type { InstallationConfiguration } from '../src/index.js';

// Synthetic values only; they deliberately differ from any real customer's commercial values.

export function makeConfig(
  patch: (base: InstallationConfiguration) => InstallationConfiguration = (c) => c,
): InstallationConfiguration {
  const base = defaultUnconfiguredConfiguration();
  // The domain type is readonly; the contract type is the mutable parsed shape.
  return patch(
    structuredClone({
      ...base,
      source: { kind: 'demo', version: 'test-1', syncedAt: '2030-01-01T00:00:00.000Z' },
      general: { enabled: true, enabledCompanyCodes: [77] },
      sales: {
        ...base.sales,
        orderTopCode: 4101,
        defaultNegotiationTypeCode: 31,
        negotiationTypes: [
          { code: 31, label: 'A vista' },
          { code: 32, label: '30 dias' },
        ],
        confirmationBehavior: 'manual',
      },
      customers: {
        ...base.customers,
        accountSellerLinks: [{ accountEmail: 'vendedor@example.test', sellerCode: 900 }],
      },
      products: { ...base.products, sellableUsageValues: ['Q1', 'Q2'] },
    }) as unknown as InstallationConfiguration,
  );
}

export const UUID_A = '0190a3c4-7b1e-7c2a-8f3d-1a2b3c4d5e6f';
export const UUID_B = '0190a3c4-7b1e-7c2a-8f3d-1a2b3c4d5e70';
