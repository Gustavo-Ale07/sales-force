import { DEMO_CONFIGURATION, FakeGateway, getDemoDataset } from '@salesforce/sankhya';
import type { InstallationConfiguration } from '@salesforce/domain';
import { describe, expect, it } from 'vitest';
import { MIRROR_SPECS, type MirrorRow } from '../../src/sync/mirror-entities.js';
import { deriveReadScope } from '../../src/sync/mirror-scope.js';

function withConfig(patch: {
  products?: Partial<InstallationConfiguration['products']>;
  pricing?: Partial<InstallationConfiguration['pricing']>;
}): InstallationConfiguration {
  return {
    ...DEMO_CONFIGURATION,
    products: { ...DEMO_CONFIGURATION.products, ...patch.products },
    pricing: { ...DEMO_CONFIGURATION.pricing, ...patch.pricing },
  };
}

describe('deriveReadScope (installation configuration -> mirror read scope)', () => {
  it('takes sellable usage, activity and price tables from the configuration, never from literals', () => {
    const scope = deriveReadScope(
      withConfig({
        products: { sellableUsageValues: ['X', 'Y'], showInactive: false },
        pricing: { mobilePriceTableCodes: [0, 5] },
      }),
    );
    expect(scope).toEqual({ products: { usageValues: ['X', 'Y'], activeOnly: true }, priceTableCodes: [0, 5] });
  });

  it('showInactive widens the product read; an unconfigured table list leaves tables unscoped', () => {
    const scope = deriveReadScope(withConfig({ products: { showInactive: true } }));
    expect(scope.products?.activeOnly).toBe(false);
    expect(scope.priceTableCodes).toBeUndefined();
  });

  it('an empty sellable list stays empty (nothing is sellable), it is not widened to "everything"', () => {
    expect(deriveReadScope(withConfig({ products: { sellableUsageValues: [] } })).products?.usageValues).toEqual([]);
  });

  it('never asks the ERP for the mobility field: it is not persisted and is PENDING_VALIDATION', () => {
    const scope = deriveReadScope(withConfig({}));
    expect(scope.products?.mobilitySourceField).toBeUndefined();
  });
});

describe('mirror specs pass the scope to the gateway', () => {
  it('reads only the configured price tables, versions and prices', async () => {
    const dataset = getDemoDataset();
    const gateway = new FakeGateway({ dataset });
    const only = dataset.priceTables[0]!.code;
    const scope = { priceTableCodes: [only] };
    const read = async (entity: 'priceTables' | 'priceTableVersions' | 'listPrices') => {
      const rows: MirrorRow[] = [];
      for await (const batch of MIRROR_SPECS[entity].read({ gateway, description: gateway.describe(), warn: () => undefined, scope })) {
        rows.push(...batch);
      }
      return rows;
    };
    expect((await read('priceTables')).map((r) => r.key)).toEqual([[only]]);
    const versions = await read('priceTableVersions');
    expect(versions).toHaveLength(1);
    const prices = await read('listPrices');
    expect(prices.length).toBeGreaterThan(0);
    expect(prices.every((r) => r.key[0] === versions[0]!.key[0])).toBe(true);
  });
});
