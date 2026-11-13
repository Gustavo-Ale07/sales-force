import { DEMO_CONFIGURATION, DEMO_DERIVED_TABLE_CODE, DEMO_FALLBACK_TABLE_CODE, DEMO_MAIN_TABLE_CODE } from '@salesforce/sankhya';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { restrictedKeys, startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { closeAllThenStop, startPostgres, type TestPostgres } from '../helpers/postgres.js';

/**
 * Owner ruling 2026-11-13 (A): one price table's CURRENT prices, for the device to keep per table. Server-side rules:
 * only tables the installation uses on the mobile (mobilePriceTableCodes, the fallback and the catalog reference table),
 * only mobility-visible, sellable products with a price above zero, list price only (P-20: no cost, no margin).
 */
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let ctx: CommercialApp;

beforeAll(async () => {
  postgres = await startPostgres();
  ctx = await startCommercialApp(postgres, opened);
});
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

async function pages(who: 'admin' | 'manager' | 'seller1' | 'seller2', code: number, pageSize = 50): Promise<{ first: Json; items: Json[] }> {
  const items: Json[] = [];
  let first: Json | undefined;
  for (let page = 1; page <= 200; page += 1) {
    const response = await ctx.call(who, 'GET', `/price-tables/${code}/prices?page=${page}&pageSize=${pageSize}`);
    expect(response.status).toBe(200);
    first ??= response.body;
    items.push(...(response.body.items as Json[]));
    if (items.length >= response.body.total || response.body.items.length === 0) break;
  }
  return { first: first as Json, items };
}

describe('GET /price-tables/{code}/prices', () => {
  it('returns the effective version prices of a table the installation uses, to every role', async () => {
    for (const who of ['admin', 'manager', 'seller1', 'seller2'] as const) {
      const { first, items } = await pages(who, DEMO_MAIN_TABLE_CODE);
      expect(first.tableCode).toBe(DEMO_MAIN_TABLE_CODE);
      expect(typeof first.tableName).toBe('string');
      expect(typeof first.versionId).toBe('number');
      expect(first.total).toBe(items.length);
      expect(items.length).toBeGreaterThan(0);
    }
  });

  it('carries the list price only, always above zero, once per product, ordered by code (P-20)', async () => {
    const { first, items } = await pages('seller1', DEMO_MAIN_TABLE_CODE);
    expect(restrictedKeys(first)).toEqual([]);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(['productCode', 'unitPrice']);
      expect(Number(item.unitPrice)).toBeGreaterThan(0);
    }
    const codes = items.map((item) => item.productCode as number);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual([...codes].sort((a, b) => a - b));
  });

  it('matches the price the catalog shows for the same table (same effective version, same products)', async () => {
    const { items } = await pages('manager', DEMO_MAIN_TABLE_CODE);
    const byCode = new Map(items.map((item) => [item.productCode as number, item.unitPrice as string]));
    const catalog = await ctx.call('manager', 'GET', '/products?pageSize=100&sellable=true');
    expect(catalog.status).toBe(200);
    for (const product of catalog.body.items as Json[]) {
      expect(product.listPrice.state).toBe('priced');
      expect(byCode.get(product.code)).toBe(product.listPrice.unitPrice);
    }
  });

  it('a table the installation does not use on the mobile, a missing one and a malformed code are all refused alike', async () => {
    expect(DEMO_CONFIGURATION.pricing.mobilePriceTableCodes).toBeUndefined();
    const fallback = await ctx.call('seller1', 'GET', `/price-tables/${DEMO_FALLBACK_TABLE_CODE}/prices`);
    expect(fallback.status).toBe(200);
    const unused = await ctx.call('seller1', 'GET', `/price-tables/${DEMO_DERIVED_TABLE_CODE}/prices`);
    const missing = await ctx.call('seller1', 'GET', '/price-tables/987654/prices');
    expect(unused.status).toBe(404);
    expect(missing.status).toBe(404);
    expect({ code: unused.body.code, message: unused.body.message }).toEqual({ code: missing.body.code, message: missing.body.message });
    expect((await ctx.call('seller1', 'GET', '/price-tables/abc/prices')).status).toBe(400);
  });
});
