import {
  CustomerDetailSchema,
  CustomersResponseSchema,
  DashboardResponseSchema,
  ProductDetailSchema,
  ProductGroupsResponseSchema,
  ProductsResponseSchema,
  SellersResponseSchema,
} from '@salesforce/contracts';
import {
  isCustomerInScope,
  isProductSellable,
  isProductVisible,
  normalizeDecimalString,
  resolveCustomerPriceTable,
  resolveListPrice,
  type ListPrice,
  type ListPriceState,
  type Product,
} from '@salesforce/domain';
import { DEMO_CONFIGURATION, getDemoDataset } from '@salesforce/sankhya';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { restrictedKeys, startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

const dataset = getDemoDataset();
const config = DEMO_CONFIGURATION;
const SELLER_1 = 103;
const SELLER_2 = 107;

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
  for (const close of opened.reverse()) await close();
  await postgres.stop();
});

async function allPages(who: 'manager' | 'seller1' | 'seller2' | 'admin', path: string): Promise<Json[]> {
  const items: Json[] = [];
  for (let page = 1; ; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const { status, body } = await ctx.call(who, 'GET', `${path}${separator}page=${page}&pageSize=100`);
    expect(status).toBe(200);
    items.push(...body.items);
    if (items.length >= body.total || body.items.length === 0) return items;
  }
}

describe('sellers', () => {
  it('lists sellers with the contract shape', async () => {
    const { status, body } = await ctx.call('manager', 'GET', '/sellers');
    expect(status).toBe(200);
    expect(SellersResponseSchema.safeParse(body).success).toBe(true);
    expect(body.items).toHaveLength(dataset.sellers.length);
  });
});

describe('customers: scope, search, filters, pagination', () => {
  const inScope = (sellerCode: number) => dataset.customers.filter((c) => isCustomerInScope(c, { kind: 'sellers', sellerCodes: [sellerCode] }));

  it('a seller sees exactly their own portfolio; a manager sees all', async () => {
    const own = await allPages('seller1', '/customers');
    expect(own.map((c) => c.code).sort((a, b) => a - b)).toEqual(inScope(SELLER_1).map((c) => c.code).sort((a, b) => a - b));
    expect(own.every((c) => c.sellerCode === SELLER_1)).toBe(true);

    const all = await allPages('manager', '/customers');
    expect(all).toHaveLength(dataset.customers.length);
  });

  it('paginates with a stable total', async () => {
    const first = await ctx.call('manager', 'GET', '/customers?page=1&pageSize=10&sort=code');
    const second = await ctx.call('manager', 'GET', '/customers?page=2&pageSize=10&sort=code');
    expect(first.body.total).toBe(dataset.customers.length);
    expect(first.body.items).toHaveLength(10);
    expect(second.body.items[0].code).toBeGreaterThan(first.body.items[9].code);
    expect(CustomersResponseSchema.safeParse(first.body).success).toBe(true);
  });

  it('searches by name, trade name, tax id digits and code', async () => {
    const sample = dataset.customers.find((c) => c.document !== null && c.tradeName !== null);
    if (sample === undefined) throw new Error('fixture has no customer with a document');
    const byName = await ctx.call('manager', 'GET', `/customers?search=${encodeURIComponent(sample.name.slice(0, 8))}&pageSize=100`);
    expect(byName.body.items.map((c: Json) => c.code)).toContain(sample.code);
    const byDoc = await ctx.call('manager', 'GET', `/customers?search=${sample.document}`);
    expect(byDoc.body.items.map((c: Json) => c.code)).toContain(sample.code);
    const byCode = await ctx.call('manager', 'GET', `/customers?search=${sample.code}`);
    expect(byCode.body.items.map((c: Json) => c.code)).toContain(sample.code);
  });

  it('treats LIKE metacharacters in the search text as literal text', async () => {
    const { status, body } = await ctx.call('manager', 'GET', '/customers?search=%25');
    expect(status).toBe(200);
    expect(body.total).toBe(0);
    const underscore = await ctx.call('manager', 'GET', '/customers?search=_____');
    expect(underscore.body.total).toBe(0);
  });

  it('filters by status, seller and price table presence (seller filter cannot widen a seller scope)', async () => {
    const blocked = await allPages('manager', '/customers?status=blocked');
    expect(blocked.map((c) => c.code).sort()).toEqual(dataset.customers.filter((c) => c.blocked).map((c) => c.code).sort());
    expect(blocked.every((c) => c.blocked)).toBe(true);

    const inactive = await allPages('manager', '/customers?status=inactive');
    expect(inactive.map((c) => c.code).sort()).toEqual(dataset.customers.filter((c) => !c.active).map((c) => c.code).sort());

    const noTable = await allPages('manager', '/customers?hasPriceTable=false');
    expect(noTable.every((c) => c.priceTableCode === null)).toBe(true);
    expect(noTable).toHaveLength(dataset.customers.filter((c) => c.priceTableCode === null).length);

    const other = await ctx.call('seller1', 'GET', `/customers?sellerCode=${SELLER_2}`);
    expect(other.status).toBe(200);
    expect(other.body.total).toBe(0);
  });

  it('rejects out-of-range and non-numeric query values with 400', async () => {
    expect((await ctx.call('manager', 'GET', '/customers?pageSize=101')).status).toBe(400);
    expect((await ctx.call('manager', 'GET', '/customers?page=0')).status).toBe(400);
    expect((await ctx.call('manager', 'GET', '/customers?sort=creditLimit')).status).toBe(400);
  });

  it('detail: resolved price table via the domain rule, credit limit per configuration, contract-valid', async () => {
    const withoutTable = dataset.customers.find((c) => c.priceTableCode === null && c.sellerCode === SELLER_1 && c.active);
    const target = withoutTable ?? dataset.customers.find((c) => c.priceTableCode === null);
    if (target === undefined) throw new Error('fixture has no customer without a price table');
    const { status, body } = await ctx.call('manager', 'GET', `/customers/${target.code}`);
    expect(status).toBe(200);
    expect(CustomerDetailSchema.safeParse(body).success).toBe(true);
    const resolved = resolveCustomerPriceTable(target, config);
    expect(resolved.kind).toBe('table');
    expect(body.resolvedPriceTable).toEqual(
      resolved.kind === 'table' ? { code: resolved.code, source: resolved.source } : null,
    );
    expect(body.creditLimit === null ? null : normalizeDecimalString(body.creditLimit)).toBe(
      target.creditLimit === null ? null : normalizeDecimalString(target.creditLimit),
    );
  });

  it('an out-of-scope or unknown customer is 404, indistinguishable from each other', async () => {
    const foreign = dataset.customers.find((c) => c.sellerCode === SELLER_2);
    if (foreign === undefined) throw new Error('fixture has no customer of seller 107');
    const denied = await ctx.call('seller1', 'GET', `/customers/${foreign.code}`);
    const missing = await ctx.call('seller1', 'GET', '/customers/2000000000');
    expect(denied.status).toBe(404);
    expect(missing.status).toBe(404);
    expect({ ...denied.body, details: undefined }).toEqual({ ...missing.body, details: undefined });
    // Beyond the PostgreSQL integer range: no match, never a 500.
    expect((await ctx.call('seller1', 'GET', '/customers/99999999999')).status).toBe(404);
  });

  it('never carries cost, margin or commission fields', async () => {
    const list = await ctx.call('manager', 'GET', '/customers?pageSize=5');
    const detail = await ctx.call('manager', 'GET', `/customers/${list.body.items[0].code}`);
    expect(restrictedKeys(list.body)).toEqual([]);
    expect(restrictedKeys(detail.body)).toEqual([]);
  });
});

describe('products and prices', () => {
  const versions = dataset.priceTableVersions;
  const prices = new Map<string, ListPrice>(dataset.listPrices.map((p) => [`${p.versionId}:${p.productCode}`, p]));
  const findPrice = (versionId: number, productCode: number) => prices.get(`${versionId}:${productCode}`);

  function expectedState(product: Product, tableCode: number | null): ListPriceState {
    const table = tableCode === null ? ({ kind: 'no_resolved_table' } as const) : ({ kind: 'table', code: tableCode, source: 'customer' } as const);
    return resolveListPrice({ productCode: product.code, table, versions, findPrice, at }).state;
  }

  it('SQL and domain agree on sellable, visibility and price state for every product (catalog reference table)', async () => {
    const referenceTable = config.pricing.catalogReferenceTableCode;
    const items = await allPages('manager', '/products');
    const visible = dataset.products.filter((p) => isProductVisible(p, config, expectedState(p, referenceTable)));
    expect(items.map((p) => p.code).sort((a, b) => a - b)).toEqual(visible.map((p) => p.code).sort((a, b) => a - b));
    for (const item of items) {
      const product = dataset.products.find((p) => p.code === item.code);
      if (product === undefined) throw new Error(`unknown product ${item.code}`);
      expect(item.sellable, `sellable ${item.code}`).toBe(isProductSellable(product, config));
      expect(item.listPrice.state, `price state ${item.code}`).toBe(expectedState(product, referenceTable));
    }
  });

  it('SQL and domain agree per customer table, including the fallback for a customer without a table', async () => {
    const customer = dataset.customers.find((c) => c.priceTableCode === null);
    if (customer === undefined) throw new Error('fixture has no customer without a price table');
    const resolved = resolveCustomerPriceTable(customer, config);
    const tableCode = resolved.kind === 'table' ? resolved.code : null;
    const items = await allPages('manager', `/products?customerCode=${customer.code}`);
    for (const item of items) {
      const product = dataset.products.find((p) => p.code === item.code);
      if (product === undefined) throw new Error(`unknown product ${item.code}`);
      expect(item.listPrice.state, `price state ${item.code}`).toBe(expectedState(product, tableCode));
    }
  });

  it('a missing price is state none with a null price, never 0; an explicit zero stays zero', async () => {
    const items = await allPages('manager', '/products');
    const none = items.filter((p) => p.listPrice.state === 'none');
    const zero = items.filter((p) => p.listPrice.state === 'zero');
    expect(none.length).toBeGreaterThan(0);
    expect(zero.length).toBeGreaterThan(0);
    for (const item of none) {
      expect(item.listPrice.unitPrice).toBeNull();
      expect(item.listPrice.noPriceReason).not.toBeNull();
    }
    for (const item of zero) expect(item.listPrice.unitPrice).toBe('0');
  });

  it('filters by sellable, priceState, group and search', async () => {
    const sellable = await allPages('manager', '/products?sellable=true');
    expect(sellable.every((p) => p.sellable)).toBe(true);
    const none = await allPages('manager', '/products?priceState=none');
    expect(none.every((p) => p.listPrice.state === 'none')).toBe(true);
    const group = dataset.productGroups[0];
    if (group === undefined) throw new Error('fixture has no group');
    const inGroup = await allPages('manager', `/products?group=${group.code}`);
    expect(inGroup.every((p) => p.groupCode === group.code)).toBe(true);
    const sample = dataset.products[10];
    if (sample === undefined) throw new Error('fixture has no product');
    const found = await ctx.call('manager', 'GET', `/products?search=${encodeURIComponent(sample.description)}&pageSize=100`);
    expect(found.body.items.map((p: Json) => p.code)).toContain(sample.code);
    expect(ProductsResponseSchema.safeParse(found.body).success).toBe(true);
  });

  it('product detail: contract-valid, hidden products are 404, unknown are 404', async () => {
    const sample = dataset.products.find((p) => p.active);
    if (sample === undefined) throw new Error('fixture has no active product');
    const ok = await ctx.call('seller1', 'GET', `/products/${sample.code}`);
    expect(ok.status).toBe(200);
    expect(ProductDetailSchema.safeParse(ok.body).success).toBe(true);
    const inactive = dataset.products.find((p) => !p.active);
    if (inactive !== undefined) expect((await ctx.call('seller1', 'GET', `/products/${inactive.code}`)).status).toBe(404);
    expect((await ctx.call('seller1', 'GET', '/products/1')).status).toBe(404);
    // A customer query for a customer out of scope is not resolved for another seller.
    const foreign = dataset.customers.find((c) => c.sellerCode === SELLER_2);
    if (foreign === undefined) throw new Error('fixture has no customer of seller 107');
    expect((await ctx.call('seller1', 'GET', `/products/${sample.code}?customerCode=${foreign.code}`)).status).toBe(404);
    expect((await ctx.call('seller1', 'GET', `/products?customerCode=${foreign.code}`)).status).toBe(404);
  });

  it('lists product groups derived from the catalog', async () => {
    const { status, body } = await ctx.call('seller1', 'GET', '/product-groups');
    expect(status).toBe(200);
    expect(ProductGroupsResponseSchema.safeParse(body).success).toBe(true);
    expect(body.items.map((g: Json) => g.code).sort()).toEqual(dataset.productGroups.map((g) => g.code).sort());
    const first = dataset.productGroups[0];
    expect(body.items.find((g: Json) => g.code === first?.code)?.name).toBe(first?.name);
  });

  it('never carries cost, margin or commission fields', async () => {
    for (const who of ['admin', 'manager', 'seller1', 'seller2'] as const) {
      const list = await ctx.call(who, 'GET', '/products?pageSize=100');
      expect(list.status, who).toBe(200);
      expect(restrictedKeys(list.body), who).toEqual([]);
      const code = list.body.items[0]?.code;
      expect(code, who).toBeDefined();
      const detail = await ctx.call(who, 'GET', `/products/${code}`);
      expect(detail.status, who).toBe(200);
      expect(restrictedKeys(detail.body), who).toEqual([]);
    }
  });
});

describe('dashboard', () => {
  it('returns real counts inside the scope and no invented credit or positivation figures', async () => {
    const manager = await ctx.call('manager', 'GET', '/dashboard');
    expect(manager.status).toBe(200);
    expect(DashboardResponseSchema.safeParse(manager.body).success).toBe(true);
    const metric = (body: Json, group: string, key: string): Json =>
      body.groups.find((g: Json) => g.key === group).metrics.find((m: Json) => m.key === key);
    expect(metric(manager.body, 'portfolio', 'customers_total').value.value).toBe(dataset.customers.length);

    const seller = await ctx.call('seller1', 'GET', '/dashboard');
    expect(metric(seller.body, 'portfolio', 'customers_total').value.value).toBe(
      dataset.customers.filter((c) => c.sellerCode === SELLER_1).length,
    );
    expect(metric(seller.body, 'credit', 'credit_indicators').value).toBeNull();
    expect(metric(seller.body, 'positivation', 'positivation_rate').value).toBeNull();
    expect(restrictedKeys(seller.body)).toEqual([]);
  });
});
