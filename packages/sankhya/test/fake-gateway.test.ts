import { findEffectiveVersion, resolveCustomerPriceTable, resolveListPrice } from '@salesforce/domain';
import { describe, expect, it } from 'vitest';
import {
  DEMO_ACCOUNTS,
  DEMO_CONFIGURATION,
  DEMO_DERIVED_TABLE_CODE,
  DEMO_FALLBACK_TABLE_CODE,
  DEMO_MAIN_TABLE_CODE,
  FakeGateway,
  NotImplementedError,
  SankhyaGatewayError,
  generateDemoDataset,
  getDemoDataset,
} from '../src/index.js';
import { collect, runGatewayContract } from './support/gateway-contract.js';

runGatewayContract('FakeGateway', {
  create: () => new FakeGateway({ batchSize: 37 }),
  createFailing: (kind) =>
    new FakeGateway({
      faults: [{ entity: 'sellers', afterBatches: 0, error: new SankhyaGatewayError(kind, { code: `fake_${kind}`, message: `synthetic ${kind} failure` }) }],
    }),
});

const dataset = getDemoDataset();
const NOW = '2026-09-18T12:00:00.000Z';

describe('demo dataset (synthetic fixtures)', () => {
  it('has the documented volumes', () => {
    expect(dataset.sellers).toHaveLength(12);
    expect(dataset.customers).toHaveLength(250);
    expect(dataset.productGroups).toHaveLength(12);
    expect(dataset.products).toHaveLength(400);
    expect(dataset.priceTables).toHaveLength(3);
    expect(dataset.priceTableVersions).toHaveLength(6);
    // list prices cover roughly 65% of (products x the three tables' effective + older versions with rows)
    expect(dataset.listPrices.length).toBeGreaterThan(800);
  });

  it('is deterministic and frozen', () => {
    expect(generateDemoDataset()).toEqual(dataset);
    expect(generateDemoDataset(1)).not.toEqual(dataset);
    expect(Object.isFrozen(dataset.customers[0])).toBe(true);
    expect(() => {
      (dataset.customers as unknown as unknown[]).push({});
    }).toThrow();
  });

  it('keeps keys unique and ordered', () => {
    for (const rows of [dataset.sellers, dataset.customers, dataset.products, dataset.productGroups, dataset.priceTables]) {
      const codes = rows.map((r) => r.code);
      expect(new Set(codes).size).toBe(codes.length);
      expect([...codes].sort((a, b) => a - b)).toEqual(codes);
    }
  });

  it('covers the required customer variety', () => {
    const c = dataset.customers;
    expect(c.filter((x) => !x.active).length).toBeGreaterThan(5);
    expect(c.filter((x) => x.blocked).length).toBeGreaterThan(0);
    expect(c.filter((x) => x.priceTableCode === null).length).toBeGreaterThan(5);
    expect(c.filter((x) => x.sellerCode === null).length).toBeGreaterThan(5);
    expect(c.filter((x) => x.document !== null && x.document.length === 14).length).toBeGreaterThan(100);
    expect(c.filter((x) => x.document !== null && x.document.length === 11).length).toBeGreaterThan(20);
    expect(c.filter((x) => x.creditLimit === null).length).toBeGreaterThan(5);
    expect(new Set(c.map((x) => x.creditLimit)).size).toBeGreaterThan(8);
    // A customer tied to the inactive seller exists.
    const inactive = dataset.sellers.find((s) => !s.active);
    expect(inactive).toBeDefined();
    expect(c.some((x) => x.sellerCode === inactive?.code)).toBe(true);
    // Names are unique and invented.
    expect(new Set(c.map((x) => x.name)).size).toBe(c.length);
  });

  it('uses obviously invalid tax ids (wrong check digits, 999 marker), never a valid CPF/CNPJ', () => {
    const weights = (n: number) => Array.from({ length: n }, (_, i) => n + 1 - i);
    const digit = (digits: number[]) => {
      const sum = digits.reduce((acc, d, i) => acc + d * (weights(digits.length)[i] as number), 0);
      const r = sum % 11;
      return r < 2 ? 0 : 11 - r;
    };
    const cnpjWeights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    for (const customer of dataset.customers) {
      if (customer.document === null) continue;
      const digits = customer.document.split('').map(Number);
      expect(customer.document).toMatch(/^\d+$/);
      if (digits.length === 11) {
        expect(customer.document.startsWith('999')).toBe(true);
        expect(digit(digits.slice(0, 9))).not.toBe(digits[9]);
      } else {
        expect(digits).toHaveLength(14);
        expect(customer.document.startsWith('9999')).toBe(true);
        const sum = digits.slice(0, 12).reduce((acc, d, i) => acc + d * ([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2][i] as number), 0);
        const r = sum % 11;
        expect(r < 2 ? 0 : 11 - r).not.toBe(digits[12]);
        void cnpjWeights;
      }
    }
  });

  it('has the required product variety', () => {
    const p = dataset.products;
    expect(new Set(p.map((x) => x.unit))).toEqual(new Set(['UN', 'CX', 'KG', 'M', 'PC']));
    expect(new Set(p.map((x) => x.brand).filter((b) => b !== null)).size).toBeGreaterThanOrEqual(10);
    expect(p.filter((x) => !x.active).length).toBeGreaterThan(10);
    const usage = new Set(p.map((x) => x.usageCode));
    expect(usage.size).toBeLessThanOrEqual(6);
    const sellable = p.filter((x) => x.active && DEMO_CONFIGURATION.products.sellableUsageValues.includes(x.usageCode ?? ''));
    expect(sellable.length).toBeGreaterThan(100);
    expect(p.filter((x) => x.active && !DEMO_CONFIGURATION.products.sellableUsageValues.includes(x.usageCode ?? '')).length).toBeGreaterThan(50);
    expect(new Set(p.map((x) => x.description)).size).toBe(p.length);
    const groups = new Set(dataset.productGroups.map((g) => g.code));
    expect(p.every((x) => x.groupCode !== null && groups.has(x.groupCode))).toBe(true);
  });

  it('models price tables with an older and an effective version, the derived table without rows', () => {
    const versionsByTable = new Map<number, number>();
    for (const v of dataset.priceTableVersions) versionsByTable.set(v.tableCode, (versionsByTable.get(v.tableCode) ?? 0) + 1);
    expect([...versionsByTable.values()]).toEqual([2, 2, 2]);
    for (const table of dataset.priceTables) {
      const effective = findEffectiveVersion(table.code, dataset.priceTableVersions, NOW);
      const older = dataset.priceTableVersions.filter((v) => v.tableCode === table.code && v.versionId !== effective?.versionId);
      expect(effective).not.toBeNull();
      expect(older).toHaveLength(1);
      // Superseded versions stay stored (F-39).
      expect(Date.parse((older[0] as { effectiveFrom: string }).effectiveFrom)).toBeLessThan(Date.parse((effective as { effectiveFrom: string }).effectiveFrom));
    }
    const derived = dataset.priceTables.find((t) => t.code === DEMO_DERIVED_TABLE_CODE);
    expect(derived?.originTableCode).toBe(DEMO_MAIN_TABLE_CODE);
    const derivedVersionIds = new Set(dataset.priceTableVersions.filter((v) => v.tableCode === DEMO_DERIVED_TABLE_CODE).map((v) => v.versionId));
    expect(dataset.listPrices.some((row) => derivedVersionIds.has(row.versionId))).toBe(false);
  });

  it('distributes price states: priced, explicit zero and no row', () => {
    const findPrice = (versionId: number, productCode: number) => dataset.listPrices.find((r) => r.versionId === versionId && r.productCode === productCode);
    const counts = { priced: 0, zero: 0, none: 0 };
    for (const product of dataset.products) {
      const result = resolveListPrice({
        productCode: product.code,
        table: { kind: 'table', code: DEMO_MAIN_TABLE_CODE, source: 'customer' },
        versions: dataset.priceTableVersions,
        findPrice,
        at: NOW,
      });
      counts[result.state] += 1;
    }
    expect(counts.priced + counts.zero + counts.none).toBe(400);
    expect(counts.zero).toBeGreaterThan(0);
    expect(counts.priced / 400).toBeGreaterThan(0.5);
    expect(counts.priced / 400).toBeLessThan(0.8);
    expect(counts.none).toBeGreaterThan(50);
    // Only rows that exist are returned: absent is never a zero row.
    expect(dataset.listPrices.every((r) => /^\d+(\.\d*[1-9])?$/.test(r.unitPrice))).toBe(true);
  });

  it('has unique (version, product) price rows', () => {
    const keys = dataset.listPrices.map((r) => `${r.versionId}:${r.productCode}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('demo configuration', () => {
  it('is consistent with the dataset and avoids real-installation literals (CFG-6)', () => {
    const sellers = new Map(dataset.sellers.map((s) => [s.code, s]));
    for (const link of DEMO_CONFIGURATION.customers.accountSellerLinks) {
      expect(sellers.get(link.sellerCode)?.active).toBe(true);
    }
    const tables = new Set(dataset.priceTables.map((t) => t.code));
    expect(tables.has(DEMO_FALLBACK_TABLE_CODE)).toBe(true);
    expect(tables.has(DEMO_MAIN_TABLE_CODE)).toBe(true);
    // The fallback table is nobody's own table, so the fallback path is observable.
    expect(dataset.customers.some((c) => c.priceTableCode === DEMO_FALLBACK_TABLE_CODE)).toBe(false);
    const withoutTable = dataset.customers.find((c) => c.priceTableCode === null);
    expect(withoutTable).toBeDefined();
    expect(resolveCustomerPriceTable(withoutTable as never, DEMO_CONFIGURATION)).toEqual({
      kind: 'table',
      code: DEMO_FALLBACK_TABLE_CODE,
      source: 'fallback',
    });
    expect(DEMO_CONFIGURATION.source.kind).toBe('demo');
    expect(DEMO_CONFIGURATION.sales.confirmationBehavior).toBe('disabled');
    expect(DEMO_CONFIGURATION.sales.orderTopCode).not.toBe(1001);
    expect(Object.isFrozen(DEMO_CONFIGURATION)).toBe(true);
  });

  it('exports the demo accounts the seeder needs, all on the .local domain', () => {
    expect(DEMO_ACCOUNTS.map((a) => a.role)).toEqual(['admin', 'manager', 'seller', 'seller']);
    for (const account of DEMO_ACCOUNTS) expect(account.email).toMatch(/@demo\.salesforce\.local$/);
    const linked = new Set(DEMO_CONFIGURATION.customers.accountSellerLinks.map((l) => l.accountEmail));
    expect(linked.has('admin@demo.salesforce.local')).toBe(false);
    for (const email of linked) expect(DEMO_ACCOUNTS.some((a) => a.email === email)).toBe(true);
  });

  it('serves the configuration snapshot and describes itself as the demo source', async () => {
    const gateway = new FakeGateway();
    expect(await gateway.readConfiguration()).toBe(DEMO_CONFIGURATION);
    const description = gateway.describe();
    expect(description).toMatchObject({ mode: 'fake', environmentKind: 'demo', host: null });
    expect(description.capabilities.configurationSource).toBe('demo');
    expect(description.capabilities.readMechanism).toBe('fixtures');
  });
});

describe('FakeGateway behavior', () => {
  it('delivers batches of the requested size', async () => {
    const { batches, rows } = await collect(new FakeGateway({ batchSize: 100 }).readCustomers());
    expect(batches.map((b) => b.length)).toEqual([100, 100, 50]);
    expect(rows).toEqual(dataset.customers);
  });

  it('injects failures after N batches, as an incomplete snapshot', async () => {
    const error = new SankhyaGatewayError('temporary', { code: 'incomplete_snapshot', message: 'synthetic' });
    const gateway = new FakeGateway({ batchSize: 100, faults: [{ entity: 'customers', afterBatches: 1, error }] });
    const seen: number[] = [];
    await expect(
      (async () => {
        for await (const batch of gateway.readCustomers()) seen.push(batch.length);
      })(),
    ).rejects.toBe(error);
    expect(seen).toEqual([100]);
  });

  it('rejects an invalid batch size', () => {
    expect(() => new FakeGateway({ batchSize: 0 })).toThrow(RangeError);
  });

  it('never implements order submission', async () => {
    await expect(new FakeGateway().submitOrder({ originId: 'x', customerCode: 1, sellerCode: null, items: [] })).rejects.toBeInstanceOf(NotImplementedError);
  });
});
