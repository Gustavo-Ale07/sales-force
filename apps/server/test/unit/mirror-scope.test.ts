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
    expect(scope).toEqual({
      products: { usageValues: ['X', 'Y'], activeOnly: true, mobilitySourceField: 'AD_MOBILIDADE', mobilityAllowedValues: ['S'] },
      priceTableCodes: [0, 5],
    });
  });

  it('showInactive widens the product read; an unconfigured table list leaves tables unscoped', () => {
    const scope = deriveReadScope(withConfig({ products: { showInactive: true } }));
    expect(scope.products?.activeOnly).toBe(false);
    expect(scope.priceTableCodes).toBeUndefined();
  });

  it('an empty sellable list stays empty (nothing is sellable), it is not widened to "everything"', () => {
    expect(deriveReadScope(withConfig({ products: { sellableUsageValues: [] } })).products?.usageValues).toEqual([]);
  });

  it('always asks for AD_MOBILIDADE = S, with the default configuration (no mobilityFilter block) too (owner ruling 2026-11-13)', () => {
    const config = withConfig({});
    expect(config.products.mobilityFilter).toBeUndefined();
    expect(deriveReadScope(config).products).toMatchObject({ mobilitySourceField: 'AD_MOBILIDADE', mobilityAllowedValues: ['S'] });
  });

  it('a disabled or unvalidated mobilityFilter block cannot switch the gate off or change the allowed value', () => {
    const pending = withConfig({
      products: { mobilityFilter: { sourceField: 'AD_OUTRO', allowedValues: ['S', 'N'], validation: 'pending_validation', mode: 'disabled' } },
    });
    expect(deriveReadScope(pending).products).toMatchObject({ mobilitySourceField: 'AD_MOBILIDADE', mobilityAllowedValues: ['S'] });
  });

  it('asks for the mobility field and its allowed values when enforced and validated (D-S)', () => {
    const scope = deriveReadScope(
      withConfig({
        products: { mobilityFilter: { sourceField: 'AD_MOBILIDADE', allowedValues: ['S'], validation: 'validated', mode: 'enforced' } },
      }),
    );
    expect(scope.products).toMatchObject({ mobilitySourceField: 'AD_MOBILIDADE', mobilityAllowedValues: ['S'] });
  });
});

describe('customer eligibility (D-V 4)', () => {
  it('is absent from the scope when the configuration has none', () => {
    expect(deriveReadScope(withConfig({})).customers).toBeUndefined();
  });

  it('is copied from the configuration, never from literals', () => {
    const config: InstallationConfiguration = {
      ...withConfig({}),
      customers: {
        ...DEMO_CONFIGURATION.customers,
        eligibility: { activeOnly: true, requiredFlags: ['CLIENTE'], columnIn: [{ column: 'CLASSIFICMS', values: ['R'] }] },
      },
    };
    expect(deriveReadScope(config).customers).toEqual({
      activeOnly: true,
      requiredFlags: ['CLIENTE'],
      columnIn: [{ column: 'CLASSIFICMS', values: ['R'] }],
    });
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

  it('the customers sync reports how many each eligibility criterion left out (D-V)', async () => {
    const dataset = getDemoDataset();
    const base = dataset.customers[0]!;
    const customers = [
      { ...base, code: 1, active: true, sourceAttributes: { CLASSIFICMS: 'R' } },
      { ...base, code: 2, active: true, sourceAttributes: { CLASSIFICMS: 'C' } },
    ];
    const gateway = new FakeGateway({ dataset: { ...dataset, customers } });
    const warnings: string[] = [];
    const scope = { customers: { activeOnly: true, requiredFlags: ['CLIENTE'], columnIn: [{ column: 'CLASSIFICMS', values: ['R'] }] } };
    const rows: MirrorRow[] = [];
    for await (const batch of MIRROR_SPECS.customers.read({ gateway, description: gateway.describe(), warn: (m: string) => warnings.push(m), scope })) rows.push(...batch);
    expect(rows.map((r) => r.key)).toEqual([[1]]);
    expect(warnings).toContain('customers: left out by eligibility - column:CLASSIFICMS: 1');
  });
});
