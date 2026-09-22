import { erpProduct } from '@salesforce/db';
import { ResolveProductsResponseSchema, type ProductListItem } from '@salesforce/contracts';
import { DEMO_CONFIGURATION, getDemoDataset } from '@salesforce/sankhya';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_ORIGIN } from '../helpers/auth.js';
import { restrictedKeys, startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { startPostgres, type TestPostgres } from '../helpers/postgres.js';

/**
 * POST /product-resolutions: exact, batched product lookup for the order editor's paste/import.
 * The demo mirror is extended with synthetic products in a code range (9 100 000+) the demo dataset
 * never uses, so every ambiguity and visibility case is controlled by this file. The demo
 * configuration hides inactive products (`showInactive: false`) and treats usage codes A/B as sellable.
 */
const dataset = getDemoDataset();
const SELLER_1 = 103;
const SELLER_2 = 107;

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let ctx: CommercialApp;

interface Extra {
  readonly code: number;
  readonly reference: string | null;
  readonly active?: boolean;
  readonly usageCode?: string | null;
  readonly deleted?: boolean;
}

const EXTRA: readonly Extra[] = [
  { code: 9_100_001, reference: 'ZZ-UNIQ-1' },
  { code: 9_100_002, reference: 'ZZ-DUP' },
  { code: 9_100_003, reference: 'ZZ-DUP' },
  // Seven products share a reference: only the first five by code are candidates.
  ...Array.from({ length: 7 }, (_, index): Extra => ({ code: 9_100_010 + index, reference: 'ZZ-MANY' })),
  // The code 9100021 is also the reference of product 9100020.
  { code: 9_100_020, reference: '9100021' },
  { code: 9_100_021, reference: 'ZZ-CODE-CLASH' },
  // Hidden by configuration (inactive): never found, never a candidate.
  { code: 9_100_030, reference: 'ZZ-HIDDEN', active: false },
  { code: 9_100_031, reference: 'ZZ-HALF' },
  { code: 9_100_032, reference: 'ZZ-HALF', active: false },
  // Visible but not sellable (usage code outside the configured set).
  { code: 9_100_040, reference: 'ZZ-NOSELL', usageCode: 'Z' },
  { code: 9_100_041, reference: 'ZZ-NOUSAGE', usageCode: null },
  // Soft-deleted by reconciliation.
  { code: 9_100_050, reference: 'ZZ-DELETED', deleted: true },
];

async function insertExtras(app: CommercialApp): Promise<void> {
  const syncedAt = new Date('2026-09-18T00:00:00.000Z');
  await app.database.handle.db.insert(erpProduct).values(
    EXTRA.map((extra) => ({
      code: extra.code,
      description: `Produto sintetico ${extra.code}`,
      reference: extra.reference,
      brand: null,
      unit: 'UN',
      groupCode: null,
      groupName: null,
      usageCode: extra.usageCode === undefined ? 'A' : extra.usageCode,
      active: extra.active ?? true,
      contentHash: `test-${extra.code}`,
      syncedAt,
      deletedAt: extra.deleted === true ? syncedAt : null,
    })),
  );
}

beforeAll(async () => {
  postgres = await startPostgres();
  ctx = await startCommercialApp(postgres, opened);
  await insertExtras(ctx);
});

afterAll(async () => {
  for (const close of opened.reverse()) await close();
  await postgres.stop();
});

const resolve = (who: 'admin' | 'manager' | 'seller1' | 'seller2', identifiers: unknown, customerCode?: unknown) =>
  ctx.call(who, 'POST', '/product-resolutions', {
    ...(customerCode === undefined ? {} : { customerCode }),
    identifiers,
  });

async function allProducts(app: CommercialApp): Promise<ProductListItem[]> {
  const { body } = await app.call('seller1', 'GET', '/products?pageSize=100');
  return body.items;
}

const codesOf =(items: readonly ProductListItem[] | undefined): number[] => (items ?? []).map((item) => item.code);

describe('POST /product-resolutions', () => {
  it('finds a product by its code and by its reference, in the contract shape', async () => {
    const { status, body } = await resolve('seller1', ['9100001', 'ZZ-UNIQ-1']);
    expect(status).toBe(200);
    const parsed = ResolveProductsResponseSchema.parse(body);
    expect(parsed.items.map((item) => item.status)).toEqual(['found', 'found']);
    expect(parsed.items.map((item) => item.identifier)).toEqual(['9100001', 'ZZ-UNIQ-1']);
    for (const item of parsed.items) {
      expect(item.product?.code).toBe(9_100_001);
      expect(item.product?.reference).toBe('ZZ-UNIQ-1');
      expect(item.candidates).toBeUndefined();
    }
    expect(parsed.priceContext.source).toBe('catalog_reference');
    expect(parsed.priceContext.customerCode).toBeNull();
  });

  it('trims identifiers and matches the reference exactly (case-sensitive, no partial or wildcard match)', async () => {
    const { body } = await resolve('seller1', ['  ZZ-UNIQ-1  ', 'zz-uniq-1', 'ZZ-UNIQ', 'ZZ-UNIQ-1%', 'ZZ-UNIQ-_', '%']);
    expect(body.items.map((item: Json) => item.status)).toEqual([
      'found',
      'not_found',
      'not_found',
      'not_found',
      'not_found',
      'not_found',
    ]);
    expect(body.items[0].identifier).toBe('ZZ-UNIQ-1');
    for (const item of body.items.slice(1)) {
      expect(item.product).toBeUndefined();
      expect(item.candidates).toBeUndefined();
    }
  });

  it('is not_found for unknown identifiers, including a numeric one beyond the integer range', async () => {
    const { status, body } = await resolve('seller1', ['NAO-EXISTE', '9999999', '99999999999999999999', '2147483648']);
    expect(status).toBe(200);
    expect(body.items.map((item: Json) => item.status)).toEqual(['not_found', 'not_found', 'not_found', 'not_found']);
  });

  it('never normalises a numeric identifier: a leading zero is not the code', async () => {
    const { body } = await resolve('seller1', ['9100001', '09100001', '009100001', '9100001 ']);
    expect(body.items.map((item: Json) => item.status)).toEqual(['found', 'not_found', 'not_found', 'found']);
  });

  it('is ambiguous when products share a reference, or when a code is another product reference', async () => {
    const { body } = await resolve('seller1', ['ZZ-DUP', '9100021']);
    const [dup, clash] = body.items;
    expect(dup.status).toBe('ambiguous');
    expect(dup.product).toBeUndefined();
    expect(codesOf(dup.candidates)).toEqual([9_100_002, 9_100_003]);
    expect(clash.status).toBe('ambiguous');
    expect(codesOf(clash.candidates)).toEqual([9_100_020, 9_100_021]);
  });

  it('returns at most 5 candidates, ordered by code', async () => {
    const { body } = await resolve('seller1', ['ZZ-MANY']);
    expect(body.items[0].status).toBe('ambiguous');
    expect(codesOf(body.items[0].candidates)).toEqual([9_100_010, 9_100_011, 9_100_012, 9_100_013, 9_100_014]);
    expect(ResolveProductsResponseSchema.safeParse(body).success).toBe(true);
  });

  it('treats a product hidden by the configuration as not found, never as a candidate', async () => {
    const { body } = await resolve('seller1', ['ZZ-HIDDEN', '9100030', 'ZZ-HALF']);
    expect(body.items[0].status).toBe('not_found');
    expect(body.items[1].status).toBe('not_found');
    // One visible and one hidden product share the reference: the visible one is the only match.
    expect(body.items[2].status).toBe('found');
    expect(body.items[2].product.code).toBe(9_100_031);
    // The same rule as GET /products/{code}.
    expect((await ctx.call('seller1', 'GET', '/products/9100030')).status).toBe(404);
  });

  it('treats a product without a price as not found when the configuration hides those (productWithoutPrice.visible=false)', async () => {
    const strict = await startCommercialApp(postgres, opened, {
      configuration: {
        ...DEMO_CONFIGURATION,
        products: { ...DEMO_CONFIGURATION.products, productWithoutPrice: { visible: false, orderable: false } },
      },
    });
    await insertExtras(strict);
    const priced = (await allProducts(strict)).find((item) => item.listPrice.state === 'priced');
    if (priced === undefined) throw new Error('fixture has no priced product');
    const { body } = await strict.call('seller1', 'POST', '/product-resolutions', {
      identifiers: ['ZZ-UNIQ-1', String(priced.code)],
    });
    // ZZ-UNIQ-1 has no price row in the reference table: hidden, hence not found. A priced product is found.
    expect(body.items.map((item: Json) => item.status)).toEqual(['not_found', 'found']);
    // The default configuration shows the same product.
    expect((await resolve('seller1', ['ZZ-UNIQ-1'])).body.items[0].status).toBe('found');
  });

  it('ignores soft-deleted products', async () => {
    const { body } = await resolve('seller1', ['ZZ-DELETED', '9100050']);
    expect(body.items.map((item: Json) => item.status)).toEqual(['not_found', 'not_found']);
  });

  it('returns a visible but non-sellable product with sellable=false', async () => {
    const { body } = await resolve('seller1', ['ZZ-NOSELL', '9100041']);
    expect(body.items.map((item: Json) => item.status)).toEqual(['found', 'found']);
    expect(body.items[0].product.sellable).toBe(false);
    expect(body.items[1].product.sellable).toBe(false);
  });

  it('answers one item per request position, in request order, duplicates included', async () => {
    const identifiers = ['ZZ-UNIQ-1', 'NAO-EXISTE', 'ZZ-DUP', 'ZZ-UNIQ-1', '9100001', 'NAO-EXISTE', 'ZZ-NOSELL'];
    const { body } = await resolve('manager', identifiers);
    expect(body.items.map((item: Json) => item.identifier)).toEqual(identifiers);
    expect(body.items.map((item: Json) => item.status)).toEqual([
      'found',
      'not_found',
      'ambiguous',
      'found',
      'found',
      'not_found',
      'found',
    ]);
    expect(body.items[0].product).toEqual(body.items[3].product);
    expect(body.items[0].product).toEqual(body.items[4].product);
  });

  it('resolves a batch of 500 identifiers in one request', async () => {
    const identifiers = Array.from({ length: 500 }, (_, index) => (index % 2 === 0 ? 'ZZ-UNIQ-1' : `NADA-${index}`));
    const { status, body } = await resolve('seller1', identifiers);
    expect(status).toBe(200);
    expect(body.items).toHaveLength(500);
    expect(body.items[0].status).toBe('found');
    expect(body.items[499].status).toBe('not_found');
  });

  describe('prices', () => {
    it('come from the catalog reference table without a customer, and match GET /products/{code}', async () => {
      const sample = dataset.products.find((product) => product.active);
      if (sample === undefined) throw new Error('fixture has no active product');
      const detail = await ctx.call('seller1', 'GET', `/products/${sample.code}`);
      const { body } = await resolve('seller1', [String(sample.code)]);
      expect(body.items[0].status).toBe('found');
      const { usageCode: _usageCode, priceContext: _priceContext, ...listItem } = detail.body;
      expect(body.items[0].product).toEqual(listItem);
      expect(body.priceContext).toEqual(detail.body.priceContext);
    });

    it("come from the customer's price book when customerCode is given, matching GET /products/{code}", async () => {
      const customer = dataset.customers.find((c) => c.sellerCode === SELLER_1 && c.priceTableCode !== null);
      if (customer === undefined) throw new Error('fixture has no customer of seller 103 with a price table');
      const sample = dataset.products.find((product) => product.active);
      if (sample === undefined) throw new Error('fixture has no active product');
      const detail = await ctx.call('seller1', 'GET', `/products/${sample.code}?customerCode=${customer.code}`);
      const { status, body } = await resolve('seller1', [String(sample.code)], customer.code);
      expect(status).toBe(200);
      expect(body.items[0].product.listPrice).toEqual(detail.body.listPrice);
      expect(body.priceContext).toEqual(detail.body.priceContext);
      expect(body.priceContext.customerCode).toBe(customer.code);
    });
  });

  describe('customer scope', () => {
    it('is 404 for a customer outside the seller scope and for an unknown one', async () => {
      const foreign = dataset.customers.find((c) => c.sellerCode === SELLER_2);
      if (foreign === undefined) throw new Error('fixture has no customer of seller 107');
      expect((await resolve('seller1', ['ZZ-UNIQ-1'], foreign.code)).status).toBe(404);
      expect((await resolve('seller1', ['ZZ-UNIQ-1'], 2_147_483_647)).status).toBe(404);
      // The same customer is fine for its own seller and for a manager.
      expect((await resolve('seller2', ['ZZ-UNIQ-1'], foreign.code)).status).toBe(200);
      expect((await resolve('manager', ['ZZ-UNIQ-1'], foreign.code)).status).toBe(200);
    });
  });

  describe('P-20: restricted data', () => {
    it('carries no cost, margin or commission key for any role', async () => {
      const sampleCode = String(dataset.products[0]?.code);
      for (const who of ['seller1', 'seller2', 'manager', 'admin'] as const) {
        const { status, body } = await resolve(who, ['ZZ-UNIQ-1', 'ZZ-DUP', 'NAO-EXISTE', sampleCode]);
        expect(status).toBe(200);
        expect(restrictedKeys(body), who).toEqual([]);
        expect(JSON.stringify(body)).not.toMatch(/cost|margin|margem|commission|comiss/i);
      }
    });
  });

  describe('validation and authentication', () => {
    it('rejects 501 identifiers, none, an empty one, a long one and control characters with 400', async () => {
      const invalid: unknown[][] = [
        Array.from({ length: 501 }, (_, index) => `P${index}`),
        [],
        ['   '],
        ['A'.repeat(41)],
        ['A\u0000B'],
        ['ok', 7],
      ];
      for (const identifiers of invalid) {
        const { status, body } = await resolve('seller1', identifiers);
        expect(status, JSON.stringify(identifiers).slice(0, 40)).toBe(400);
        expect(body.code).toBe('validation_failed');
      }
      expect((await resolve('seller1', ['A'.repeat(40)])).status).toBe(200);
    });

    it('rejects a bad customerCode, unknown keys and an empty body with 400', async () => {
      for (const customerCode of [0, -3, 1.5, 2_147_483_648, '103']) {
        expect((await resolve('seller1', ['x'], customerCode)).status, String(customerCode)).toBe(400);
      }
      expect((await ctx.call('seller1', 'POST', '/product-resolutions', { identifiers: ['x'], cost: true })).status).toBe(400);
      expect((await ctx.call('seller1', 'POST', '/product-resolutions', {})).status).toBe(400);
    });

    it('rejects a body above 128 kB even when its content would be valid', async () => {
      const send = (payload: string) =>
        ctx.app.inject({
          method: 'POST',
          url: '/api/v1/product-resolutions',
          headers: { origin: TEST_ORIGIN, cookie: ctx.cookies.seller1, 'content-type': 'application/json' },
          payload,
        });
      const oversized = await send(`{"identifiers":["ZZ-UNIQ-1"]${' '.repeat(130 * 1024)}}`);
      expect(oversized.statusCode).toBe(400);
      expect(oversized.json<Json>().code).toBe('validation_failed');
      expect((await send(`{"identifiers":["ZZ-UNIQ-1"]${' '.repeat(120 * 1024)}}`)).statusCode).toBe(200);
    });

    it('is 401 without a session', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/product-resolutions',
        headers: { origin: TEST_ORIGIN, 'content-type': 'application/json' },
        payload: JSON.stringify({ identifiers: ['ZZ-UNIQ-1'] }),
      });
      expect(response.statusCode).toBe(401);
    });
  });
});
