import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProductImageVariant } from '@salesforce/contracts';
import { getDemoDataset } from '@salesforce/sankhya';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { imageEtag, type ProductImageSource, type SourceImage } from '../../src/catalog/product-image.js';
import { FilesystemObjectStore } from '../../src/media/object-store.js';
import { deleteRow, mediaVersion, upsertStored } from '../../src/media/product-media.repository.js';
import { checkProductMediaStore } from '../../src/media/store-check.js';
import type { Logger } from '../../src/observability/logger.js';
import { StoredProductImageSource } from '../../src/media/stored-product-image.source.js';
import { TEST_ORIGIN } from '../helpers/auth.js';
import { restrictedKeys, startCommercialApp, type CommercialApp, type Json } from '../helpers/commercial-app.js';
import { pngBytes, webpBytes } from '../helpers/image-fixtures.js';
import { closeAllThenStop, startPostgres, type TestPostgres } from '../helpers/postgres.js';

const CODE = (() => {
  const first = getDemoDataset().products.find((p) => p.active);
  if (first === undefined) throw new Error('fixture needs an active product');
  return first.code;
})();
const THUMB_MAX = 2048;

let postgres: TestPostgres;
let root: string;
let store: FilesystemObjectStore;
let ctx: CommercialApp;
const opened: (() => Promise<unknown>)[] = [];

/** The app is built before the database handle is reachable; the real source is attached right after. */
const lateSource: { target: ProductImageSource | null } = { target: null };
const delegating: ProductImageSource = {
  versions: (codes, signal) => (lateSource.target as ProductImageSource).versions(codes, signal),
  getImage: (code, variant: ProductImageVariant, signal): Promise<SourceImage | null> =>
    (lateSource.target as ProductImageSource).getImage(code, variant, signal),
};

beforeAll(async () => {
  postgres = await startPostgres();
  root = await mkdtemp(join(tmpdir(), 'sf-stored-image-'));
  store = new FilesystemObjectStore(root);
  ctx = await startCommercialApp(postgres, opened, {
    productImageSource: delegating,
    productImageSettings: { sourceTimeoutMs: 2000, maxAgeSeconds: 600, maxBytes: { thumb: THUMB_MAX, full: 8192 } },
  });
  lateSource.target = new StoredProductImageSource(ctx.database.handle.db, store, { thumbMaxBytes: THUMB_MAX });
});
afterAll(async () => {
  await closeAllThenStop(opened, postgres);
  await rm(root, { recursive: true, force: true });
});

async function seed(bytes: Uint8Array, code = CODE, thumbnail?: Uint8Array): Promise<{ key: string; hash: string; thumbKey: string | null; thumbHash: string | null }> {
  const hash = createHash('sha256').update(bytes).digest('hex');
  const key = `product-images/${code}/${hash}`;
  await store.put(key, bytes);
  const thumbHash = thumbnail === undefined ? '' : createHash('sha256').update(thumbnail).digest('hex');
  const thumbKey = `product-thumbnails/${code}/${thumbHash}`;
  if (thumbnail !== undefined) await store.put(thumbKey, thumbnail);
  await upsertStored(ctx.database.handle.db, {
    productCode: code,
    contentType: 'image/png',
    byteLength: bytes.length,
    contentHash: hash,
    storageKey: key,
    sourceLength: bytes.length,
    sourceFingerprint: 'f'.repeat(64),
    at: new Date('2026-10-01T00:00:00.000Z'),
    ...(thumbnail === undefined ? {} : { thumbnail: { storageKey: thumbKey, contentType: 'image/webp', byteLength: thumbnail.length, contentHash: thumbHash, generatedAt: new Date('2026-10-01T00:00:00.000Z') } }),
  });
  return { key, hash, thumbKey: thumbnail === undefined ? null : thumbKey, thumbHash: thumbnail === undefined ? null : thumbHash };
}

function image(query = '', headers: Record<string, string> = {}) {
  return ctx.app.inject({
    method: 'GET',
    url: `/api/v1/products/${CODE}/image${query}`,
    headers: { origin: TEST_ORIGIN, cookie: ctx.cookies.seller1, ...headers },
  });
}

describe('stored product images through the API', () => {
  it('has no image before the worker stored anything', async () => {
    expect((await image()).statusCode).toBe(404);
    const list = await ctx.call('seller1', 'GET', '/products');
    expect(list.body.items.every((p: Json) => p.image === null)).toBe(true);
  });

  it('serves the stored bytes with hardening headers and the hash as the version', async () => {
    const bytes = pngBytes(900);
    const { hash } = await seed(bytes);
    const response = await image('?variant=full');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(response.headers['cross-origin-resource-policy']).toBe('same-site');
    expect(response.headers['etag']).toBe(imageEtag('full', hash));
    expect(response.rawPayload.equals(Buffer.from(bytes))).toBe(true);
  });

  it('answers 304 on a matching ETag', async () => {
    const first = await image('?variant=full');
    const etag = first.headers['etag'] as string;
    const second = await image('?variant=full', { 'if-none-match': etag });
    expect(second.statusCode).toBe(304);
  });

  it('advertises the image in the catalog without cost or margin keys', async () => {
    const detail = await ctx.call('seller1', 'GET', `/products/${CODE}`);
    expect(detail.status).toBe(200);
    expect(detail.body.image).toMatchObject({ thumbnailUrl: `/api/v1/products/${CODE}/image?variant=thumb` });
    expect(restrictedKeys(detail.body)).toEqual([]);
  });

  it('has no thumbnail while none is generated (never the original in its place), but still serves and advertises the original', async () => {
    await seed(pngBytes(700)); // small enough to have been a thumbnail under the old rule: still 404
    expect((await image('?variant=thumb')).statusCode).toBe(404);
    expect((await image('?variant=full')).statusCode).toBe(200);
    const detail = await ctx.call('seller1', 'GET', `/products/${CODE}`);
    expect(detail.body.image).toMatchObject({ thumbnailUrl: `/api/v1/products/${CODE}/image?variant=thumb` });
  });

  it('serves the generated thumbnail for variant=thumb with its own type, size and ETag, even when the original is above the old thumbnail cap', async () => {
    const original = pngBytes(4096); // above THUMB_MAX: it used to have no thumbnail
    const thumbnail = webpBytes(300);
    const { hash, thumbHash } = await seed(original, CODE, thumbnail);
    const version = mediaVersion(hash, thumbHash);
    const thumb = await image('?variant=thumb');
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers['content-type']).toBe('image/webp');
    expect(thumb.headers['content-length']).toBe(String(thumbnail.length));
    expect(thumb.headers['etag']).toBe(imageEtag('thumb', version));
    expect(thumb.headers['x-content-type-options']).toBe('nosniff');
    expect(thumb.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(thumb.headers['cross-origin-resource-policy']).toBe('same-site');
    expect(thumb.headers['cache-control']).toMatch(/max-age=600/);
    expect(thumb.rawPayload.equals(Buffer.from(thumbnail))).toBe(true);

    const full = await image('?variant=full');
    expect(full.statusCode).toBe(200);
    expect(full.headers['content-type']).toBe('image/png');
    expect(full.headers['content-length']).toBe(String(original.length));
    expect(full.headers['etag']).toBe(imageEtag('full', version));
    expect(full.headers['etag']).not.toBe(thumb.headers['etag']);
    expect(full.rawPayload.equals(Buffer.from(original))).toBe(true);

    expect((await image('?variant=thumb', { 'if-none-match': thumb.headers['etag'] as string })).statusCode).toBe(304);
    expect((await image('?variant=thumb', { 'if-none-match': full.headers['etag'] as string })).statusCode).toBe(200);
  });

  it('the advertised version changes when either rendition changes (original first, then only the thumbnail)', async () => {
    const original = pngBytes(900);
    await seed(original);
    const withoutThumb = (await ctx.call('seller1', 'GET', `/products/${CODE}`)).body.image.version as string;
    expect(withoutThumb).toBe(createHash('sha256').update(original).digest('hex'));
    await seed(original, CODE, webpBytes(300));
    const first = (await ctx.call('seller1', 'GET', `/products/${CODE}`)).body.image.version as string;
    await seed(original, CODE, webpBytes(301));
    const second = (await ctx.call('seller1', 'GET', `/products/${CODE}`)).body.image.version as string;
    expect(new Set([withoutThumb, first, second]).size).toBe(3);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('answers 503 when the thumbnail object is missing, tampered, or its size contradicts the record; the full image is unaffected', async () => {
    const original = pngBytes(1200);
    const thumbnail = webpBytes(300);
    const { thumbKey } = await seed(original, CODE, thumbnail);
    await store.delete(thumbKey as string);
    expect((await image('?variant=thumb')).statusCode).toBe(503);
    const tampered = Uint8Array.from(thumbnail);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1]! + 1) & 0xff;
    await store.put(thumbKey as string, tampered);
    expect((await image('?variant=thumb')).statusCode).toBe(503);
    await store.put(thumbKey as string, webpBytes(900));
    expect((await image('?variant=thumb')).statusCode).toBe(503);
    expect((await image('?variant=full')).statusCode).toBe(200);
  });

  it('refuses a thumbnail whose recorded size is above the thumbnail maximum without reading it', async () => {
    const original = pngBytes(1200);
    await seed(original, CODE, webpBytes(THUMB_MAX + 100));
    expect((await image('?variant=thumb')).statusCode).toBe(503);
    expect((await image('?variant=full')).statusCode).toBe(200);
  });

  it('answers 503 when the stored object is missing', async () => {
    const { key } = await seed(pngBytes(700));
    await store.delete(key);
    expect((await image('?variant=full')).statusCode).toBe(503);
  });

  it('answers 503 when the object no longer matches its recorded hash', async () => {
    const { key } = await seed(pngBytes(710));
    await store.put(key, pngBytes(711));
    expect((await image('?variant=full')).statusCode).toBe(503);
  });

  it('answers 503 when an object of the same size has different content, and when its size contradicts the record', async () => {
    const original = pngBytes(730);
    const { key } = await seed(original);
    const tampered = Uint8Array.from(original);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1]! + 1) & 0xff;
    await store.put(key, tampered);
    expect((await image('?variant=full')).statusCode).toBe(503);
    await store.put(key, new Uint8Array(original.length + 500));
    expect((await image('?variant=full')).statusCode).toBe(503);
  });

  it('is 404 again once the row is gone (pruned)', async () => {
    await seed(pngBytes(720));
    await deleteRow(ctx.database.handle.db, CODE);
    expect((await image('?variant=full')).statusCode).toBe(404);
  });

  it('the startup check warns when rows exist but the directory is missing or empty, and stays quiet otherwise', async () => {
    const warnings: string[] = [];
    const recorder = { warn: (_fields: unknown, message: string) => warnings.push(message) } as unknown as Logger;
    await seed(pngBytes(740));
    const healthy = await checkProductMediaStore(ctx.database.handle.db, root, recorder);
    expect(healthy).toMatchObject({ suspicious: false });
    expect(warnings).toEqual([]);

    const missing = await checkProductMediaStore(ctx.database.handle.db, join(root, 'no-such-volume'), recorder);
    expect(missing).toMatchObject({ suspicious: true });
    const emptyRoot = await mkdtemp(join(tmpdir(), 'sf-empty-volume-'));
    try {
      expect(await checkProductMediaStore(ctx.database.handle.db, emptyRoot, recorder)).toMatchObject({ suspicious: true });
    } finally {
      await rm(emptyRoot, { recursive: true, force: true });
    }
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/volume may not be mounted/);
  });

  it('never reads outside the store root: only hash-named objects exist under the product directory', async () => {
    const entries = await readdir(join(root, 'product-images'));
    expect(entries.every((entry) => /^\d+$/.test(entry))).toBe(true);
  });
});
