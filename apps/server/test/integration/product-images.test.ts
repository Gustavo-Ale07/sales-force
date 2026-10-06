import { ProductDetailSchema, ProductsResponseSchema } from '@salesforce/contracts';
import { getDemoDataset } from '@salesforce/sankhya';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { imageEtag } from '../../src/catalog/product-image.js';
import { TEST_ORIGIN, TEST_PASSWORD, createTestAccount } from '../helpers/auth.js';
import { loginCookie } from '../helpers/auth-app.js';
import { restrictedKeys, startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { FakeImageSource, HTML_BYTES, SVG_BYTES, jpegBytes, pngBytes, webpBytes } from '../helpers/image-fixtures.js';
import { startPostgres, type TestPostgres, closeAllThenStop } from '../helpers/postgres.js';

const dataset = getDemoDataset();
const activeProducts = dataset.products.filter((p) => p.active);
const inactive = dataset.products.find((p) => !p.active);
const [first] = activeProducts;
if (first === undefined) throw new Error('fixture needs an active product');
const CODE = first.code;

let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
const source = new FakeImageSource();
let ctx: CommercialApp;

beforeAll(async () => {
  postgres = await startPostgres();
  ctx = await startCommercialApp(postgres, opened, {
    productImageSource: source,
    productImageSettings: { sourceTimeoutMs: 150, maxAgeSeconds: 600, maxBytes: { thumb: 2048, full: 8192 } },
  });
});
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

function reset(): void {
  source.images.clear();
  source.versionOverride.clear();
  source.calls.length = 0;
  source.failWith = null;
  source.hang = false;
}

function image(code: number, query = '', headers: Record<string, string> = {}) {
  return ctx.app.inject({
    method: 'GET',
    url: `/api/v1/products/${code}/image${query}`,
    headers: { origin: TEST_ORIGIN, cookie: ctx.cookies.seller1, ...headers },
  });
}

describe('GET /products/{code}/image', () => {
  it('serves a verified image with the hardening headers', async () => {
    reset();
    const bytes = pngBytes(100);
    source.images.set(CODE, { bytes, version: 'v1', contentType: 'text/html' });
    const response = await image(CODE);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/png'); // sniffed, not the source label
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-disposition']).toBe('inline');
    expect(response.headers['cache-control']).toBe('private, max-age=600');
    expect(response.headers['etag']).toBe(imageEtag('thumb', 'v1'));
    expect(response.rawPayload.equals(Buffer.from(bytes))).toBe(true);
  });

  it('serves jpeg and webp, and the requested variant is the one asked of the source', async () => {
    reset();
    source.images.set(CODE, { bytes: jpegBytes(), version: 'v1' });
    expect((await image(CODE, '?variant=full')).headers['content-type']).toBe('image/jpeg');
    source.images.set(CODE, { bytes: webpBytes(), version: 'v1' });
    expect((await image(CODE)).headers['content-type']).toBe('image/webp');
    expect(source.calls).toContain(`getImage:${CODE}:full`);
    expect(source.calls).toContain(`getImage:${CODE}:thumb`);
  });

  it('is 404 with an ApiError body and no caching when the product has no image', async () => {
    reset();
    const response = await image(CODE);
    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).code).toBe('not_found');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('is 404 for an unknown or hidden product even when the source has an image for it', async () => {
    reset();
    source.images.set(1, { bytes: pngBytes(), version: 'v1' });
    expect((await image(1)).statusCode).toBe(404);
    if (inactive !== undefined) {
      source.images.set(inactive.code, { bytes: pngBytes(), version: 'v1' });
      expect((await image(inactive.code)).statusCode).toBe(404);
    }
    expect(source.calls).toEqual([]); // access is decided before the source is asked
  });

  it('validates the code and the variant before anything else', async () => {
    reset();
    const urls = ['/products/abc/image', '/products/-1/image', '/products/1.5/image', `/products/${CODE}/image?variant=huge`, `/products/${CODE}/image?variant=..%2F..%2Fetc`];
    for (const url of urls) {
      const response = await ctx.app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { origin: TEST_ORIGIN, cookie: ctx.cookies.seller1 } });
      expect(response.statusCode, url).toBe(400);
    }
    expect(source.calls).toEqual([]);
  });

  it('ignores any client-supplied url or path parameter', async () => {
    reset();
    source.images.set(CODE, { bytes: pngBytes(), version: 'v1' });
    const response = await image(CODE, '?url=http://169.254.169.254/&path=../../secret');
    expect(response.statusCode).toBe(200);
    expect(source.calls.join('|')).not.toMatch(/169|secret/);
  });

  it('answers 304 on a matching If-None-Match without fetching the bytes, and 200 again when the version changes', async () => {
    reset();
    source.images.set(CODE, { bytes: pngBytes(), version: 'v1' });
    const firstResponse = await image(CODE);
    const etag = firstResponse.headers['etag'] as string;
    source.calls.length = 0;
    const second304 = await image(CODE, '', { 'if-none-match': etag });
    expect(second304.statusCode).toBe(304);
    expect(second304.body).toBe('');
    expect(second304.headers['etag']).toBe(etag);
    expect(second304.headers['cache-control']).toBe('private, max-age=600');
    expect(source.calls.some((call) => call.startsWith('getImage'))).toBe(false);

    source.images.set(CODE, { bytes: pngBytes(80), version: 'v2' });
    const changed = await image(CODE, '', { 'if-none-match': etag });
    expect(changed.statusCode).toBe(200);
    expect(changed.headers['etag']).not.toBe(etag);
    // The thumb ETag does not validate the full rendition.
    expect((await image(CODE, '?variant=full', { 'if-none-match': etag })).statusCode).toBe(200);
  });

  it.each([
    ['svg', SVG_BYTES],
    ['html', HTML_BYTES],
    ['truncated png', pngBytes(100).slice(0, 60)],
    ['empty', new Uint8Array(0)],
    ['oversize thumb', pngBytes(4096)],
  ])('refuses %s from the source (404, nothing served)', async (_name, bytes) => {
    reset();
    source.images.set(CODE, { bytes, version: 'v1', contentType: 'image/png' });
    const response = await image(CODE);
    expect(response.statusCode).toBe(404);
    expect(response.rawPayload.includes(Buffer.from('<script'))).toBe(false);
  });

  it('allows a larger full rendition than a thumbnail, up to its own cap', async () => {
    reset();
    source.images.set(CODE, { bytes: pngBytes(4096), version: 'v1' });
    expect((await image(CODE, '?variant=full')).statusCode).toBe(200);
    source.images.set(CODE, { bytes: pngBytes(9000), version: 'v1' });
    expect((await image(CODE, '?variant=full')).statusCode).toBe(404);
  });

  it('refuses a source version that is not a safe opaque token', async () => {
    reset();
    source.images.set(CODE, { bytes: pngBytes(), version: 'a b"c' });
    expect((await image(CODE)).statusCode).toBe(404);
  });

  it('maps a source error to 503 without leaking the cause', async () => {
    reset();
    source.failWith = new Error('connect ECONNREFUSED 10.1.2.3:5432 password=hunter2');
    const response = await image(CODE);
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body).code).toBe('service_unavailable');
    expect(response.body).not.toMatch(/ECONNREFUSED|10\.1\.2\.3|hunter2/);
  });

  it('maps a source timeout to 503 and aborts the call', async () => {
    reset();
    source.hang = true;
    const started = Date.now();
    const response = await image(CODE);
    expect(response.statusCode).toBe(503);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(response.body).not.toMatch(/timed out/);
  });

  it('requires a session', async () => {
    reset();
    source.images.set(CODE, { bytes: pngBytes(), version: 'v1' });
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/products/${CODE}/image`, headers: { origin: TEST_ORIGIN } });
    expect(response.statusCode).toBe(401);
    expect(source.calls).toEqual([]);
  });

  it('is 403 no_seller_scope for a seller without a seller link, before the source is asked', async () => {
    reset();
    source.images.set(CODE, { bytes: pngBytes(), version: 'v1' });
    await createTestAccount(ctx.database.handle, { username: 'sem-vinculo-img@example.test', role: 'seller' }, ctx.clock.fn);
    const cookie = await loginCookie(ctx, 'sem-vinculo-img@example.test', TEST_PASSWORD);
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/products/${CODE}/image`, headers: { origin: TEST_ORIGIN, cookie } });
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).code).toBe('no_seller_scope');
    expect(source.calls).toEqual([]);
  });
});

describe('image metadata in the catalog', () => {
  it('lists metadata (version and relative paths, no bytes) with one batched source call, null when absent', async () => {
    reset();
    source.images.set(CODE, { bytes: pngBytes(), version: 'v9' });
    const list = await ctx.call('seller1', 'GET', `/products?pageSize=100&search=${CODE}`);
    expect(list.status).toBe(200);
    expect(ProductsResponseSchema.safeParse(list.body).success).toBe(true);
    const withImage = list.body.items.find((p: Json) => p.code === CODE);
    expect(withImage.image).toEqual({
      version: 'v9',
      thumbnailUrl: `/api/v1/products/${CODE}/image?variant=thumb`,
      url: `/api/v1/products/${CODE}/image?variant=full`,
    });
    expect(list.body.items.every((p: Json) => p.code === CODE || p.image === null)).toBe(true);
    expect(source.calls.filter((call) => call.startsWith('versions'))).toHaveLength(1);
    expect(source.calls.some((call) => call.startsWith('getImage'))).toBe(false);
    expect(list.response.body).not.toMatch(/base64|data:image/);
  });

  it('adds the same metadata to the detail', async () => {
    reset();
    source.images.set(CODE, { bytes: pngBytes(), version: 'v9' });
    const detail = await ctx.call('seller1', 'GET', `/products/${CODE}`);
    expect(ProductDetailSchema.safeParse(detail.body).success).toBe(true);
    expect(detail.body.image.version).toBe('v9');
  });

  it('degrades to no image, not to a failed catalog, when the source is down', async () => {
    reset();
    source.failWith = new Error('boom');
    const list = await ctx.call('seller1', 'GET', '/products?pageSize=20');
    expect(list.status).toBe(200);
    expect(list.body.items.every((p: Json) => p.image === null)).toBe(true);
  });

  it('never carries cost, margin or commission keys, with or without an image (P-20)', async () => {
    reset();
    source.images.set(CODE, { bytes: pngBytes(), version: 'v9' });
    for (const who of ['admin', 'manager', 'seller1', 'seller2'] as const) {
      expect(restrictedKeys((await ctx.call(who, 'GET', '/products?pageSize=100')).body), who).toEqual([]);
      expect(restrictedKeys((await ctx.call(who, 'GET', `/products/${CODE}`)).body), who).toEqual([]);
    }
  });
});

describe('default source', () => {
  it('without a configured source no product has an image', async () => {
    const plain = await startCommercialApp(postgres, opened);
    const list = await plain.call('seller1', 'GET', '/products?pageSize=20');
    expect(list.body.items.every((p: Json) => p.image === null)).toBe(true);
    const response = await plain.app.inject({ method: 'GET', url: `/api/v1/products/${CODE}/image`, headers: { origin: TEST_ORIGIN, cookie: plain.cookies.seller1 } });
    expect(response.statusCode).toBe(404);
  });
});
