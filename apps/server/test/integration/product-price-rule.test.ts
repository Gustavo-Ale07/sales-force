import { findEffectiveVersion, isProductVisible, resolveCustomerPriceTable, resolveListPrice, type ListPrice } from '@salesforce/domain';
import {
  DEMO_CONFIGURATION,
  DEMO_FALLBACK_TABLE_CODE,
  DEMO_MAIN_TABLE_CODE,
  getDemoDataset,
} from '@salesforce/sankhya';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { closeAllThenStop, startPostgres, type TestPostgres } from '../helpers/postgres.js';

/**
 * Owner ruling 2026-11-13: a product appears and is accepted only with ATIVO = 'S', AD_MOBILIDADE = 'S' (source filter) and a price
 * above zero in the order customer's price table (the customer's CODTAB, else the configured fallback); a catalog without a customer
 * uses the configured reference table. The demo tables stand for PLAC's 5, 6 and 3 (the codes are configuration, never literals).
 */
const dataset = getDemoDataset();
const config = DEMO_CONFIGURATION;
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let ctx: CommercialApp;
let at: string;

beforeAll(async () => {
  postgres = await startPostgres();
  ctx = await startCommercialApp(postgres, opened);
  at = ctx.clock.fn().toISOString();
});
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const prices = new Map<string, ListPrice>(dataset.listPrices.map((p) => [`${p.versionId}:${p.productCode}`, p]));
const findPrice = (versionId: number, productCode: number) => prices.get(`${versionId}:${productCode}`);

/** Codes the rule allows for a table: active, and a price above zero in the effective version. */
function expectedCodes(tableCode: number | null): number[] {
  const table = tableCode === null ? ({ kind: 'no_resolved_table' } as const) : ({ kind: 'table', code: tableCode, source: 'customer' } as const);
  return dataset.products
    .filter((product) => {
      const state = resolveListPrice({ productCode: product.code, table, versions: dataset.priceTableVersions, findPrice, at }).state;
      return state === 'priced' && isProductVisible(product, config, state);
    })
    .map((product) => product.code)
    .sort((a, b) => a - b);
}

async function codesOf(path: string): Promise<number[]> {
  const items: Json[] = [];
  for (let page = 1; ; page += 1) {
    const { status, body } = await ctx.call('manager', 'GET', `${path}${path.includes('?') ? '&' : '?'}page=${page}&pageSize=100`);
    expect(status).toBe(200);
    items.push(...body.items);
    if (items.length >= body.total || body.items.length === 0) return items.map((item) => item.code as number).sort((a, b) => a - b);
  }
}

describe('product by price (owner ruling 2026-11-13)', () => {
  it('the fixture has products with a zero price and without a price row, so the rule is exercised', () => {
    const table = { kind: 'table', code: DEMO_MAIN_TABLE_CODE, source: 'customer' } as const;
    const states = dataset.products.map((p) => resolveListPrice({ productCode: p.code, table, versions: dataset.priceTableVersions, findPrice, at }).state);
    expect(states).toContain('zero');
    expect(states).toContain('none');
    expect(states).toContain('priced');
    expect(findEffectiveVersion(DEMO_MAIN_TABLE_CODE, dataset.priceTableVersions, at)).not.toBeNull();
  });

  it('a catalog without a customer lists only products with a price above zero in the reference table', async () => {
    const codes = await codesOf('/products');
    expect(codes).toEqual(expectedCodes(config.pricing.catalogReferenceTableCode));
    expect(codes.length).toBeLessThan(dataset.products.filter((p) => p.active).length);
  });

  it('each customer table lists only its own priced products; a customer without a table uses the fallback table', async () => {
    const ownTables = new Set<number>();
    for (const customer of dataset.customers) {
      const resolved = resolveCustomerPriceTable(customer, config);
      if (resolved.kind === 'table') ownTables.add(resolved.code);
    }
    expect(ownTables.size).toBeGreaterThanOrEqual(2);
    const withoutTable = dataset.customers.find((c) => c.priceTableCode === null && c.active && !c.blocked);
    expect(resolveCustomerPriceTable(withoutTable!, config)).toMatchObject({ kind: 'table', code: DEMO_FALLBACK_TABLE_CODE, source: 'fallback' });
    const seen = new Set<string>();
    for (const customer of dataset.customers.filter((c) => c.active && !c.blocked)) {
      const resolved = resolveCustomerPriceTable(customer, config);
      const key = resolved.kind === 'table' ? String(resolved.code) : 'none';
      if (seen.has(key)) continue;
      seen.add(key);
      const codes = await codesOf(`/products?customerCode=${customer.code}`);
      expect(codes, `customer ${customer.code} table ${key}`).toEqual(expectedCodes(resolved.kind === 'table' ? resolved.code : null));
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it('the "Preço" filter is gone: priceState is ignored and never reveals unpriced products', async () => {
    const plain = await codesOf('/products');
    for (const value of ['none', 'zero', 'priced']) expect(await codesOf(`/products?priceState=${value}`)).toEqual(plain);
  });

  it('every listed product is priced; none is a zero or a missing price', async () => {
    const { body } = await ctx.call('manager', 'GET', '/products?pageSize=100');
    for (const item of body.items as Json[]) expect(item.listPrice.state).toBe('priced');
  });

  it('a product without a usable price is 404 in the detail', async () => {
    const listed = new Set(await codesOf('/products'));
    const unpriced = dataset.products.find((p) => p.active && !listed.has(p.code));
    expect(unpriced).toBeDefined();
    expect((await ctx.call('manager', 'GET', `/products/${unpriced!.code}`)).status).toBe(404);
  });
});
