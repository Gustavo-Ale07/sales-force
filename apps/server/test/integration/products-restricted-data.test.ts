import { getDemoDataset } from '@salesforce/sankhya';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_ORIGIN } from '../helpers/auth.js';
import { restrictedKeys, startCommercialApp, type CommercialApp, type Json, type Who } from '../helpers/commercial-app.js';
import { FakeImageSource, pngBytes } from '../helpers/image-fixtures.js';
import { startPostgres, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

// P-20 / mobile-spike §8.6: no /products* response, for any role, carries a cost, margin or commission key.
// Walks every page, every product detail (with and without a customer price context), search, filters, groups,
// resolutions and the image route (success, miss and error), so a new field cannot slip in on a path nobody sampled.

const dataset = getDemoDataset();
const WHO: readonly Who[] = ['admin', 'manager', 'seller1', 'seller2'];
const source = new FakeImageSource();

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let ctx: CommercialApp;

beforeAll(async () => {
  postgres = await startPostgres();
  ctx = await startCommercialApp(postgres, opened, { productImageSource: source });
});
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

async function ok(who: Who, url: string): Promise<Json> {
  const { status, body } = await ctx.call(who, 'GET', url);
  expect(status, `${who} GET ${url}`).toBe(200);
  return body;
}

async function allProducts(who: Who, query: string): Promise<Json[]> {
  const items: Json[] = [];
  // A customer outside the seller's scope answers 404 (never a list); the body must still be clean.
  const allowed = query.includes('customerCode') ? [200, 404] : [200];
  for (let page = 1; ; page += 1) {
    const { status, body } = await ctx.call(who, 'GET', `/products?${query}${query === '' ? '' : '&'}page=${page}&pageSize=100`);
    expect(allowed, `${who} /products?${query} page ${page}`).toContain(status);
    expect(restrictedKeys(body), `${who} /products?${query} page ${page}`).toEqual([]);
    if (status !== 200) return items;
    items.push(...body.items);
    if (items.length >= body.total || body.items.length === 0) return items;
  }
}

describe('/products* never carries cost, margin or commission (P-20)', () => {
  it('the detector is not vacuous', () => {
    expect(restrictedKeys({ items: [{ nested: { unitCost: '1' } }, { margem: 2 }, { commission: 3 }] })).toEqual(['unitCost', 'margem', 'commission']);
  });

  it('list: every page, every role, with filters, sorts and search', async () => {
    const sample = dataset.products.find((p) => p.active) ?? dataset.products[0];
    expect(sample).toBeDefined();
    const group = dataset.productGroups[0]?.code;
    const customer = dataset.customers[0]?.code;
    const queries = [
      '',
      `search=${encodeURIComponent(String(sample?.description ?? '').slice(0, 5))}`,
      `search=${sample?.code ?? 1}`,
      ...(group === undefined ? [] : [`group=${group}`]),
      ...(customer === undefined ? [] : [`customerCode=${customer}`]),
      'sellable=true',
      'sellable=false',
      'priceState=priced',
      'priceState=zero',
      'priceState=none',
    ];
    for (const who of WHO) {
      for (const query of queries) {
        const items = await allProducts(who, query);
        if (query === '') expect(items.length, `${who} sees products`).toBeGreaterThan(0);
      }
    }
  });

  it('detail: every visible product, with and without a customer price context', async () => {
    const customer = dataset.customers[0]?.code;
    for (const who of WHO) {
      const items = await allProducts(who, '');
      for (const item of items) {
        const plain = await ctx.call(who, 'GET', `/products/${item.code}`);
        expect(plain.status, `${who} detail ${item.code}`).toBe(200);
        expect(restrictedKeys(plain.body), `${who} detail ${item.code}`).toEqual([]);
        if (customer !== undefined) {
          const priced = await ctx.call(who, 'GET', `/products/${item.code}?customerCode=${customer}`);
          expect([200, 404], `${who} detail ${item.code} customer ${customer}`).toContain(priced.status);
          expect(restrictedKeys(priced.body), `${who} detail ${item.code} customer ${customer}`).toEqual([]);
        }
      }
    }
  });

  it('error bodies: unknown product and bad input', async () => {
    for (const who of WHO) {
      for (const url of ['/products/999999999', '/products/abc', '/products?page=0', '/products?sort=cost', '/products?pageSize=100000']) {
        const { body } = await ctx.call(who, 'GET', url);
        expect(restrictedKeys(body), `${who} ${url}`).toEqual([]);
      }
    }
  });

  it('groups and resolutions', async () => {
    const sample = dataset.products.find((p) => p.active);
    for (const who of WHO) {
      expect(restrictedKeys(await ok(who, '/product-groups')), who).toEqual([]);
      const customer = dataset.customers[0]?.code;
      for (const payload of [
        { identifiers: [String(sample?.code ?? 1), 'does-not-exist'] },
        ...(customer === undefined ? [] : [{ customerCode: customer, identifiers: [String(sample?.code ?? 1)] }]),
      ]) {
        const { body } = await ctx.call(who, 'POST', '/product-resolutions', payload);
        expect(restrictedKeys(body), who).toEqual([]);
      }
    }
  });

  it('image route: hit, miss and invalid input carry no restricted key in body or headers', async () => {
    const sample = dataset.products.find((p) => p.active);
    expect(sample).toBeDefined();
    const code = sample?.code ?? 1;
    source.images.set(code, { bytes: pngBytes(), version: 'v1' });
    const urls = [`/products/${code}/image`, `/products/${code}/image?variant=full`, '/products/999999999/image', '/products/abc/image', `/products/${code}/image?variant=huge`];
    for (const who of WHO) {
      for (const url of urls) {
        const response = await ctx.app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { origin: TEST_ORIGIN, cookie: ctx.cookies[who] } });
        const headers = Object.fromEntries(Object.entries(response.headers).map(([k, v]) => [k, String(v)]));
        expect(restrictedKeys(headers), `${who} ${url} headers`).toEqual([]);
        if (String(response.headers['content-type'] ?? '').includes('json')) {
          expect(restrictedKeys(JSON.parse(response.body)), `${who} ${url} body`).toEqual([]);
        }
      }
    }
    source.images.clear();
  });
});
