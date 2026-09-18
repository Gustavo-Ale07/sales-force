import {
  defaultUnconfiguredConfiguration,
  type Customer,
  type InstallationConfiguration,
  type ListPrice,
  type PriceTableVersion,
  type Product,
} from '../src/index.js';

// Synthetic values only. They deliberately differ from any real customer's commercial values.

export function makeConfig(
  patch: (base: InstallationConfiguration) => InstallationConfiguration = (c) => c,
): InstallationConfiguration {
  const base = defaultUnconfiguredConfiguration();
  return patch({
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
    products: { ...base.products, sellableUsageValues: ['Q1', 'Q2'] },
  });
}

export function makeCustomer(patch: Partial<Customer> = {}): Customer {
  return {
    code: 5001,
    name: 'Cliente Sintetico',
    tradeName: null,
    document: null,
    active: true,
    blocked: false,
    sellerCode: 900,
    priceTableCode: 88,
    creditLimit: null,
    ...patch,
  };
}

export function makeProduct(patch: Partial<Product> = {}): Product {
  return {
    code: 3001,
    description: 'Produto Sintetico',
    active: true,
    usageCode: 'Q1',
    groupCode: 10,
    unit: 'UN',
    brand: null,
    reference: null,
    ...patch,
  };
}

export function makeVersion(patch: Partial<PriceTableVersion> = {}): PriceTableVersion {
  return { versionId: 1, tableCode: 88, effectiveFrom: '2030-01-01T00:00:00.000Z', ...patch };
}

export function makePriceLookup(
  rows: readonly ListPrice[],
): (versionId: number, productCode: number) => ListPrice | undefined {
  return (versionId, productCode) =>
    rows.find((r) => r.versionId === versionId && r.productCode === productCode);
}
