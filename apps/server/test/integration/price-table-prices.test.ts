import { DEMO_CONFIGURATION, DEMO_DERIVED_TABLE_CODE, DEMO_FALLBACK_TABLE_CODE, DEMO_MAIN_TABLE_CODE } from '@salesforce/sankhya';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { restrictedKeys, startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { closeAllThenStop, startPostgres, type TestPostgres } from '../helpers/postgres.js';

/**
 * Owner ruling 2026-11-13 (A + scope amendment): one price table's CURRENT prices, for the device to keep per table.
 * Server-side rules: only tables used by customers WITHIN THE CALLER'S SCOPE (the customer's mobile-eligible table, or the
 * fallback table when a visible customer has none and the configuration says use_fallback_table). Any other table is the
 * same 404 as a missing one (no oracle). Only mobility-visible, sellable products with a price above zero, list price
 * only (P-20: no cost, no margin). The catalog reference table is NOT served by this route (the device never asks for it).
 *
 * Fixture: seller1 (103) customers all use MAIN (21); every other customer uses DERIVED (22), except one live customer of
 * seller2 (107) that has no table (so the fallback 23 is reachable for seller2, manager and admin, never for seller1).
 */
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let ctx: CommercialApp;
const pool = () => ctx.database.handle.pool;

beforeAll(async () => {
  postgres = await startPostgres();
  ctx = await startCommercialApp(postgres, opened);
  await pool().query(
    `update erp_customer set price_table_code = case when seller_code = 103 then ${DEMO_MAIN_TABLE_CODE} else ${DEMO_DERIVED_TABLE_CODE} end`,
  );
  await pool().query(
    `update erp_customer set price_table_code = null where code = (select min(code) from erp_customer where seller_code = 107 and deleted_at is null and is_customer and active and blocked_raw is distinct from 'S')`,
  );
});
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const withoutRequestId = (body: string): string => body.replace(/"requestId":"[^"]*"/, '"requestId":"-"');

type Who ='admin' | 'manager' | 'seller1' | 'seller2';

async function pages(who: Who, code: number, pageSize = 50): Promise<{ first: Json; items: Json[] }> {
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
  it('the fixture gives seller2 a customer without a table', async () => {
    const response = await ctx.call('seller2', 'GET', '/customers?hasPriceTable=false');
    expect(response.status).toBe(200);
    expect(response.body.total).toBeGreaterThan(0);
  });

  it("returns the effective version prices of a table used by the caller's customers", async () => {
    const expected: [Who, number][] = [
      ['seller1', DEMO_MAIN_TABLE_CODE],
      ['seller2', DEMO_DERIVED_TABLE_CODE],
      ['seller2', DEMO_FALLBACK_TABLE_CODE],
      ['manager', DEMO_MAIN_TABLE_CODE],
      ['manager', DEMO_DERIVED_TABLE_CODE],
      ['manager', DEMO_FALLBACK_TABLE_CODE],
      ['admin', DEMO_MAIN_TABLE_CODE],
      ['admin', DEMO_DERIVED_TABLE_CODE],
      ['admin', DEMO_FALLBACK_TABLE_CODE],
    ];
    for (const [who, code] of expected) {
      const { first, items } = await pages(who, code);
      expect(first.tableCode).toBe(code);
      expect(typeof first.tableName).toBe('string');
      expect(typeof first.versionId).toBe('number');
      expect(first.total).toBe(items.length);
      // Only MAIN is densely priced in the demo mirror; the others may legitimately hold no sellable priced product.
      if (code === DEMO_MAIN_TABLE_CODE) expect(items.length).toBeGreaterThan(0);
      expect(restrictedKeys(first)).toEqual([]);
    }
  });

  it("another seller's table, a fallback nobody visible needs and a missing table are the same byte-identical 404 (no oracle)", async () => {
    const missing = await ctx.call('seller1', 'GET', '/price-tables/987654/prices');
    expect(missing.status).toBe(404);
    const refusals: [Who, number][] = [
      ['seller1', DEMO_DERIVED_TABLE_CODE],
      ['seller1', DEMO_FALLBACK_TABLE_CODE],
      ['seller2', DEMO_MAIN_TABLE_CODE],
    ];
    for (const [who, code] of refusals) {
      const refused = await ctx.call(who, 'GET', `/price-tables/${code}/prices`);
      expect(refused.status).toBe(404);
      // Byte-identical apart from the per-request correlation id.
      expect(withoutRequestId(refused.response.body)).toBe(withoutRequestId(missing.response.body));
    }
  });

  it('the catalog reference table is not served merely because it is configured', async () => {
    expect(DEMO_CONFIGURATION.pricing.catalogReferenceTableCode).toBe(DEMO_MAIN_TABLE_CODE);
    expect((await ctx.call('seller2', 'GET', `/price-tables/${DEMO_MAIN_TABLE_CODE}/prices`)).status).toBe(404);
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

  it('unpriced and zero-price products are excluded by the query: every page but the last is full and total counts only priced rows', async () => {
    const pageSize = 3;
    const all = await pages('seller1', DEMO_MAIN_TABLE_CODE, 100);
    const total = all.first.total as number;
    // The mirror holds products without a price or with a zero price that the table must not count.
    const rows = await pool().query<{ n: number }>('select count(*)::int as n from erp_product where deleted_at is null');
    expect(rows.rows[0]!.n).toBeGreaterThan(total);
    const seen: number[] = [];
    const pageCount = Math.ceil(total / pageSize);
    for (let page = 1; page <= pageCount; page += 1) {
      const response = await ctx.call('seller1', 'GET', `/price-tables/${DEMO_MAIN_TABLE_CODE}/prices?page=${page}&pageSize=${pageSize}`);
      expect(response.body.total).toBe(total);
      expect(response.body.items.length).toBe(page < pageCount ? pageSize : total - pageSize * (pageCount - 1));
      seen.push(...(response.body.items as Json[]).map((item) => item.productCode as number));
    }
    expect(seen).toEqual(all.items.map((item) => item.productCode as number));
    expect((await ctx.call('seller1', 'GET', `/price-tables/${DEMO_MAIN_TABLE_CODE}/prices?page=${pageCount + 1}&pageSize=${pageSize}`)).body.items).toEqual([]);
  });

  it('a malformed code is a 400', async () => {
    expect((await ctx.call('seller1', 'GET', '/price-tables/abc/prices')).status).toBe(400);
  });
});
