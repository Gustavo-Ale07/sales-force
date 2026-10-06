import { mkdtempSync, rmSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import sharp from 'sharp';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { productMedia, syncState } from '@salesforce/db';
import {
  FakeGateway,
  getDemoDataset,
  SankhyaGatewayError,
  syntheticProductImage,
  type ProductMediaSignature,
  type ReadProductMediaBytesOptions,
  type ReadProductMediaSignaturesOptions,
  type ReadScope,
} from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemObjectStore, ObjectStoreError, type ObjectStore } from '../../src/media/object-store.js';
import {
  PRODUCT_MEDIA_ENTITY,
  ProductMediaSyncService,
  type MediaGateway,
} from '../../src/media/product-media-sync.service.js';
import { SharpThumbnailRenderer, THUMBNAIL_MAX_BYTES, type ThumbnailRenderer } from '../../src/media/thumbnail-renderer.js';
import { createLogger } from '../../src/observability/logger.js';
import { FakeThumbnailRenderer, renderFailure } from '../helpers/fake-thumbnail-renderer.js';
import { isReservedSyncEntity } from '../../src/platform/worker-heartbeat.js';
import { SVG_BYTES, HTML_BYTES, pngBytes } from '../helpers/image-fixtures.js';
import { realImage } from '../helpers/real-images.js';
import { closeAllThenStop, createMigratedDatabase, startPostgres, type MigratedDatabase, type TestPostgres } from '../helpers/postgres.js';

const dataset = getDemoDataset();
const CODES = dataset.products.filter((p) => p.active).slice(0, 6).map((p) => p.code);
const [A, B, C] = CODES as [number, number, number];
const MAX_BYTES = 8192;

let postgres: TestPostgres;
let database: MigratedDatabase;
let root: string;
let store: FilesystemObjectStore;
let images: Map<number, Uint8Array>;
let failures: Map<number, SankhyaGatewayError>;
let gateway: SpyGateway;
let renderer: FakeThumbnailRenderer;
let clockMs = Date.parse('2026-10-05T12:00:00Z');

/** Counts what the service asks of the ERP port, and can inject failures the fake does not model. */
class SpyGateway implements MediaGateway {
  readonly byteCalls: number[] = [];
  signatureCalls = 0;
  signaturesFailWith: SankhyaGatewayError | null = null;
  readonly #inner: FakeGateway;

  constructor(inner: FakeGateway) {
    this.#inner = inner;
  }
  describe() {
    return this.#inner.describe();
  }
  async readProductMediaSignatures(options: ReadProductMediaSignaturesOptions): Promise<readonly ProductMediaSignature[]> {
    this.signatureCalls += 1;
    if (this.signaturesFailWith !== null) throw this.signaturesFailWith;
    return this.#inner.readProductMediaSignatures(options);
  }
  async readProductMediaBytes(options: ReadProductMediaBytesOptions): Promise<Uint8Array> {
    this.byteCalls.push(options.productCode);
    return this.#inner.readProductMediaBytes(options);
  }
}

function makeService(
  overrides: {
    store?: ObjectStore;
    verifyObjects?: boolean;
    readScope?: () => Promise<ReadScope>;
    gateway?: MediaGateway;
    pageSize?: number;
    maxBytes?: number;
    allowFakeGateway?: boolean;
    sourceFailureLimit?: number;
    renderer?: ThumbnailRenderer;
  } = {},
): ProductMediaSyncService {
  return new ProductMediaSyncService({
    db: database.handle,
    gateway: overrides.gateway ?? gateway,
    store: overrides.store ?? store,
    renderer: overrides.renderer ?? renderer,
    logger: createLogger({ level: 'silent', service: 'worker' }),
    now: () => new Date((clockMs += 1000)),
    ...(overrides.readScope === undefined ? {} : { readScope: overrides.readScope }),
    settings: {
      maxBytes: overrides.maxBytes ?? MAX_BYTES,
      verifyObjects: overrides.verifyObjects ?? true,
      pageSize: overrides.pageSize ?? 100,
      concurrency: 2,
      allowFakeGateway: overrides.allowFakeGateway ?? true,
      sourceFailureLimit: overrides.sourceFailureLimit ?? 3,
    },
  });
}

/** The same fake data, labelled live: the only way to exercise prune, which refuses a non-live gateway. */
function liveLabelled(inner: MediaGateway): MediaGateway {
  return {
    describe: () => ({ ...inner.describe(), mode: 'live', environmentKind: 'sandbox' }) as ReturnType<MediaGateway['describe']>,
    readProductMediaSignatures: (options) => inner.readProductMediaSignatures(options),
    readProductMediaBytes: (options) => inner.readProductMediaBytes(options),
  };
}

/** Products with a usage code (a live read needs a non-empty scope) and the scope that contains all of them. */
const SCOPED = dataset.products.filter((p) => p.active && p.usageCode !== null).slice(0, 3);
const [X, Y, Z] = SCOPED.map((p) => p.code) as [number, number, number];
const FULL_SCOPE = (): Promise<ReadScope> =>
  Promise.resolve({ products: { usageValues: [...new Set(SCOPED.map((p) => p.usageCode as string))], activeOnly: true } });
const pruneService = (extra: { allowFakeGateway?: boolean } = {}) =>
  makeService({ gateway: liveLabelled(gateway), readScope: FULL_SCOPE, ...extra });

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const rowOf = async (code: number) => (await database.handle.db.select().from(productMedia).where(eq(productMedia.productCode, code)))[0];
const keyOf = (code: number, bytes: Uint8Array) => `product-images/${code}/${sha256(bytes)}`;

beforeAll(async () => {
  postgres = await startPostgres();
  database = await createMigratedDatabase(postgres);
});
afterAll(async () => {
  await closeAllThenStop([() => database.handle.close()], postgres);
});
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'sf-media-sync-'));
  store = new FilesystemObjectStore(root);
  images = new Map();
  failures = new Map();
  gateway = new SpyGateway(new FakeGateway({ media: { images, failures } }));
  renderer = new FakeThumbnailRenderer();
  await database.handle.db.delete(productMedia);
  await database.handle.db.delete(syncState).where(eq(syncState.entity, PRODUCT_MEDIA_ENTITY));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('ProductMediaSyncService: first load and change detection', () => {
  it('stores a validated image content-addressed, with metadata in PostgreSQL and bytes only in the object store', async () => {
    const bytes = syntheticProductImage('jpeg', 3000, 1);
    images.set(A, bytes);
    const result = await makeService().run();
    expect(result).toMatchObject({ outcome: 'completed', complete: true, dryRun: false });
    expect(result.stats).toMatchObject({ examined: 1, created: 1, updated: 0, unchanged: 0, failed: 0 });
    const row = await rowOf(A);
    expect(row).toMatchObject({
      status: 'stored',
      contentType: 'image/jpeg',
      byteLength: 3000,
      contentHash: sha256(bytes),
      storageKey: keyOf(A, bytes),
      sourceLength: 3000,
      failureReason: null,
      failureCount: 0,
    });
    expect(row?.sourceFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect([...((await store.get(keyOf(A, bytes))) ?? [])]).toEqual([...bytes]);
  });

  it('detects the three supported formats from the bytes', async () => {
    images.set(A, syntheticProductImage('png', 400, 1));
    images.set(B, syntheticProductImage('jpeg', 400, 2));
    images.set(C, syntheticProductImage('webp', 400, 3));
    await makeService().run();
    expect([(await rowOf(A))?.contentType, (await rowOf(B))?.contentType, (await rowOf(C))?.contentType]).toEqual([
      'image/png',
      'image/jpeg',
      'image/webp',
    ]);
  });

  it('a second run with nothing changed downloads nothing and writes nothing', async () => {
    images.set(A, syntheticProductImage('png', 2000, 1));
    images.set(B, syntheticProductImage('jpeg', 2000, 2));
    await makeService().run();
    const before = await rowOf(A);
    gateway.byteCalls.length = 0;
    const result = await makeService().run();
    expect(result.stats).toMatchObject({ examined: 2, created: 0, updated: 0, unchanged: 2, failed: 0 });
    expect(gateway.byteCalls).toEqual([]);
    expect((await rowOf(A))?.syncedAt).toEqual(before?.syncedAt);
  });

  it('a changed image replaces the row, stores the new object and removes the superseded one', async () => {
    const first = syntheticProductImage('png', 2000, 1);
    images.set(A, first);
    await makeService().run();
    const second = syntheticProductImage('png', 2500, 9);
    images.set(A, second);
    const result = await makeService().run();
    expect(result.stats).toMatchObject({ created: 0, updated: 1 });
    expect((await rowOf(A))?.storageKey).toBe(keyOf(A, second));
    expect(await store.has(keyOf(A, second))).toBe(true);
    expect(await store.has(keyOf(A, first))).toBe(false);
  });

  it('a same-length edit that misses every sampled window is NOT detected by a normal run, and IS by forceVerify (documented residual risk)', async () => {
    const first = syntheticProductImage('jpeg', 4000, 1);
    images.set(A, first);
    await makeService().run();
    const edited = Uint8Array.from(first);
    edited[100] = (edited[100]! + 1) & 0xff; // offset 100 lies in none of the sampled windows
    images.set(A, edited);
    gateway.byteCalls.length = 0;
    const normal = await makeService().run();
    expect(normal.stats).toMatchObject({ unchanged: 1, updated: 0 });
    expect(gateway.byteCalls).toEqual([]);
    expect((await rowOf(A))?.contentHash).toBe(sha256(first));

    const forced = await makeService().run({ forceVerify: true });
    expect(forced.stats).toMatchObject({ updated: 1 });
    expect(gateway.byteCalls).toEqual([A]);
    expect((await rowOf(A))?.contentHash).toBe(sha256(edited));
  });

  it('forceVerify on identical bytes re-downloads but changes nothing', async () => {
    images.set(A, syntheticProductImage('png', 1500, 4));
    await makeService().run();
    const result = await makeService().run({ forceVerify: true });
    expect(result.stats).toMatchObject({ unchanged: 1, updated: 0, created: 0 });
    expect(gateway.byteCalls.filter((code) => code === A)).toHaveLength(2);
  });

  it('pages through more products than one page', async () => {
    for (const code of CODES) images.set(code, syntheticProductImage('png', 300, code));
    const result = await makeService({ pageSize: 2 }).run();
    expect(result.stats).toMatchObject({ examined: CODES.length, created: CODES.length });
    expect(gateway.signatureCalls).toBeGreaterThanOrEqual(3);
  });
});

describe('ProductMediaSyncService: invalid and failing images', () => {
  it.each([
    ['svg', SVG_BYTES, 'unsupported_type'],
    ['html', HTML_BYTES, 'unsupported_type'],
    ['truncated png', pngBytes(100).slice(0, 60), 'corrupt'],
  ])('refuses %s: nothing stored, failure recorded, not retried until the source changes', async (_name, bytes, reason) => {
    images.set(A, bytes);
    const result = await makeService().run();
    expect(result.stats).toMatchObject({ failed: 1, created: 0 });
    expect(await rowOf(A)).toMatchObject({ status: 'failed', failureReason: reason, failureCount: 1, contentHash: null, storageKey: null });
    gateway.byteCalls.length = 0;
    const again = await makeService().run();
    expect(again.stats).toMatchObject({ skippedPermanent: 1, failed: 0 });
    expect(gateway.byteCalls).toEqual([]);
    // The source changes: it is looked at again.
    images.set(A, syntheticProductImage('png', 500, 3));
    const fixed = await makeService().run();
    expect(fixed.stats).toMatchObject({ created: 1 });
    expect(await rowOf(A)).toMatchObject({ status: 'stored', failureReason: null, failureCount: 0 });
  });

  it('forceVerify looks at a permanently failed image again', async () => {
    images.set(A, SVG_BYTES);
    await makeService().run();
    gateway.byteCalls.length = 0;
    await makeService().run({ forceVerify: true });
    expect(gateway.byteCalls).toEqual([A]);
    expect((await rowOf(A))?.failureCount).toBe(2);
  });

  it('refuses an image over the size cap without downloading it', async () => {
    images.set(A, syntheticProductImage('png', MAX_BYTES + 1, 1));
    const result = await makeService().run();
    expect(result.stats).toMatchObject({ failed: 1 });
    expect(await rowOf(A)).toMatchObject({ status: 'failed', failureReason: 'media_too_large', storageKey: null });
    expect(gateway.byteCalls).toEqual([]);
  });

  it.each([
    ['media_too_large (announced size)', 9000],
  ])('raising the size cap makes an earlier size refusal retryable without a source change: %s', async (_name, size) => {
    images.set(A, syntheticProductImage('png', size, 1));
    await makeService().run();
    expect(await rowOf(A)).toMatchObject({ status: 'failed', failureReason: 'media_too_large' });
    gateway.byteCalls.length = 0;
    const same = await makeService().run();
    expect(same.stats).toMatchObject({ skippedPermanent: 1 });
    expect(gateway.byteCalls).toEqual([]);
    const raised = await makeService({ maxBytes: 16384 }).run();
    expect(raised.stats).toMatchObject({ created: 1, failed: 0 });
    expect(await rowOf(A)).toMatchObject({ status: 'stored', failureReason: null });
  });

  it('a stored product whose source turns invalid keeps serving the previous object', async () => {
    const good = syntheticProductImage('png', 1200, 1);
    images.set(A, good);
    await makeService().run();
    images.set(A, HTML_BYTES);
    await makeService().run();
    expect(await rowOf(A)).toMatchObject({ status: 'failed', failureReason: 'unsupported_type', contentHash: sha256(good), storageKey: keyOf(A, good) });
    expect(await store.has(keyOf(A, good))).toBe(true);
  });

  it('a temporary per-product failure is recorded, does not stop the others, and is retried next run', async () => {
    images.set(A, syntheticProductImage('png', 700, 1));
    images.set(B, syntheticProductImage('png', 700, 2));
    failures.set(A, new SankhyaGatewayError('temporary', { code: 'media_changed_during_read', message: 'changed while reading' }));
    const result = await makeService().run();
    expect(result.stats).toMatchObject({ created: 1, failed: 1 });
    expect(await rowOf(A)).toMatchObject({ status: 'failed', failureReason: 'media_changed_during_read' });
    expect(await rowOf(B)).toMatchObject({ status: 'stored' });
    failures.clear();
    const retry = await makeService().run();
    expect(retry.stats).toMatchObject({ created: 1, unchanged: 1, failed: 0 });
    expect(await rowOf(A)).toMatchObject({ status: 'stored', failureCount: 0 });
  });

  it('a permanent gateway rejection of one product is recorded and not retried', async () => {
    images.set(A, syntheticProductImage('png', 700, 1));
    failures.set(A, new SankhyaGatewayError('permanent', { code: 'sql_error', message: 'rejected' }));
    await makeService().run();
    expect(await rowOf(A)).toMatchObject({ status: 'failed', failureReason: 'gateway_permanent' });
    gateway.byteCalls.length = 0;
    const again = await makeService().run();
    expect(again.stats).toMatchObject({ skippedPermanent: 1 });
    expect(gateway.byteCalls).toEqual([]);
  });
});

describe('ProductMediaSyncService: fake-gateway guard', () => {
  it('refuses to store a non-live gateway unless the fake is explicitly allowed, and records nothing', async () => {
    images.set(A, syntheticProductImage('png', 700, 1));
    await expect(makeService({ allowFakeGateway: false }).run()).rejects.toMatchObject({ name: 'PermanentJobError' });
    expect(await rowOf(A)).toBeUndefined();
    expect(gateway.signatureCalls).toBe(0);
    expect(await database.handle.db.select().from(syncState).where(eq(syncState.entity, PRODUCT_MEDIA_ENTITY))).toEqual([]);
  });

  it('a live gateway needs no opt-in', async () => {
    images.set(X, syntheticProductImage('png', 700, 1));
    const result = await pruneService({ allowFakeGateway: false }).run();
    expect(result.stats).toMatchObject({ created: 1 });
  });
});

describe('ProductMediaSyncService: run-level failures', () => {
  it('an unavailable ERP fails the run as retryable, records it in sync_state and leaves rows untouched', async () => {
    images.set(A, syntheticProductImage('png', 700, 1));
    await makeService().run();
    gateway.signaturesFailWith = new SankhyaGatewayError('unavailable', { code: 'http_503', message: 'down' });
    await expect(makeService().run()).rejects.toMatchObject({ kind: 'unavailable', retryable: true });
    const [state] = await database.handle.db.select().from(syncState).where(eq(syncState.entity, PRODUCT_MEDIA_ENTITY));
    expect(state).toMatchObject({ status: 'failed', lastErrorClass: 'unavailable' });
    expect(state?.lastSuccessAt).not.toBeNull();
    expect(await rowOf(A)).toMatchObject({ status: 'stored' });
  });

  it('a whole-source outage (every download unavailable) aborts the run as retryable and persists no per-product failure', async () => {
    for (const code of [A, B]) {
      images.set(code, syntheticProductImage('png', 700, code));
      failures.set(code, new SankhyaGatewayError('unavailable', { code: 'http_503', message: 'down' }));
    }
    await expect(makeService().run({ concurrency: 1 })).rejects.toMatchObject({ kind: 'unavailable', retryable: true });
    expect(await rowOf(A)).toBeUndefined();
    expect(await rowOf(B)).toBeUndefined();
    const [state] = await database.handle.db.select().from(syncState).where(eq(syncState.entity, PRODUCT_MEDIA_ENTITY));
    expect(state).toMatchObject({ status: 'failed', lastErrorClass: 'unavailable' });
  });

  it('a lone unavailable product with nothing else to download is indistinguishable from an outage: the run aborts and nothing is counted', async () => {
    for (const code of [A, B]) images.set(code, syntheticProductImage('png', 700, code));
    await makeService().run();
    failures.set(A, new SankhyaGatewayError('unavailable', { code: 'http_503', message: 'down' }));
    images.set(A, syntheticProductImage('png', 710, A));
    await expect(makeService().run()).rejects.toMatchObject({ kind: 'unavailable' });
    expect(await rowOf(A)).toMatchObject({ status: 'stored', failureCount: 0 });
  });

  it('a streak of unavailable downloads reaching the limit aborts the run at once, before the rest of the catalog is attempted', async () => {
    for (const code of CODES) {
      images.set(code, syntheticProductImage('png', 700, code));
      failures.set(code, new SankhyaGatewayError('unavailable', { code: 'http_503', message: 'down' }));
    }
    await expect(makeService({ sourceFailureLimit: 2 }).run({ concurrency: 1 })).rejects.toMatchObject({ kind: 'unavailable' });
    expect(gateway.byteCalls).toHaveLength(2);
  });

  it('one poison product does not starve the others: they are stored, and it is parked as source_unavailable after the limit', async () => {
    for (const code of [A, B, C]) images.set(code, syntheticProductImage('png', 700, code));
    failures.set(A, new SankhyaGatewayError('unavailable', { code: 'http_503', message: 'down' }));
    const first = await makeService().run({ concurrency: 1 });
    expect(first.stats).toMatchObject({ created: 2, failed: 1 });
    expect(await rowOf(A)).toMatchObject({ status: 'failed', failureReason: 'gateway_unavailable', failureCount: 1 });
    expect(await rowOf(B)).toMatchObject({ status: 'stored' });
    expect(await rowOf(C)).toMatchObject({ status: 'stored' });

    // The source is only proved up by a download that succeeds in the same run: B changes every run.
    images.set(B, syntheticProductImage('png', 701, B));
    await makeService().run({ concurrency: 1 });
    expect(await rowOf(A)).toMatchObject({ failureReason: 'gateway_unavailable', failureCount: 2 });
    images.set(B, syntheticProductImage('png', 702, B));
    await makeService().run({ concurrency: 1 });
    expect(await rowOf(A)).toMatchObject({ failureReason: 'source_unavailable', failureCount: 3 });

    gateway.byteCalls.length = 0;
    const parked = await makeService().run({ concurrency: 1 });
    expect(parked.stats).toMatchObject({ skippedPermanent: 1, failed: 0 });
    expect(gateway.byteCalls).toEqual([]);

    // Once the source serves it again, a forced verification picks it up.
    failures.clear();
    const forced = await makeService().run({ forceVerify: true, concurrency: 1 });
    expect(forced.stats).toMatchObject({ created: 1 });
    expect(await rowOf(A)).toMatchObject({ status: 'stored', failureReason: null, failureCount: 0 });
  });

  it('an authentication failure aborts the run and is not retryable', async () => {
    images.set(A, syntheticProductImage('png', 700, 1));
    failures.set(A, new SankhyaGatewayError('auth', { code: 'http_401', message: 'rejected' }));
    await expect(makeService().run()).rejects.toMatchObject({ kind: 'auth', retryable: false });
    expect(await rowOf(A)).toBeUndefined();
  });

  it('an object-store write failure aborts the run as retryable and stores nothing', async () => {
    images.set(A, syntheticProductImage('png', 700, 1));
    const broken: ObjectStore = {
      put: () => Promise.reject(new ObjectStoreError('unavailable', 'Object store write failed (ENOSPC).')),
      get: () => Promise.resolve(null),
      has: () => Promise.resolve(false),
      delete: () => Promise.resolve(),
    };
    const error = await makeService({ store: broken }).run().catch((raised: unknown) => raised);
    expect(error).toMatchObject({ name: 'TransientJobError' });
    expect(await rowOf(A)).toBeUndefined();
    const [state] = await database.handle.db.select().from(syncState).where(eq(syncState.entity, PRODUCT_MEDIA_ENTITY));
    expect(state).toMatchObject({ status: 'failed', lastErrorClass: 'temporary' });
  });

  it('a cancelled run is a transient failure and writes nothing partial', async () => {
    images.set(A, syntheticProductImage('png', 700, 1));
    const controller = new AbortController();
    controller.abort();
    await expect(makeService().run({ signal: controller.signal })).rejects.toMatchObject({ name: 'TransientJobError' });
    expect(await rowOf(A)).toBeUndefined();
  });

  it('a second run while one is in progress skips (advisory lock)', async () => {
    images.set(A, syntheticProductImage('png', 700, 1));
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signalEntered: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const blocking: MediaGateway = {
      describe: () => gateway.describe(),
      readProductMediaSignatures: async (options) => {
        signalEntered();
        await held;
        return gateway.readProductMediaSignatures(options);
      },
      readProductMediaBytes: (options) => gateway.readProductMediaBytes(options),
    };
    const first = makeService({ gateway: blocking }).run();
    await entered; // the first run holds the advisory lock once it is reading signatures
    const second = await makeService().run();
    expect(second).toMatchObject({ outcome: 'skipped_locked', stats: null });
    release();
    expect((await first).outcome).toBe('completed');
  });

  it('refuses to run against a live gateway without a usable read scope', async () => {
    const live: MediaGateway = {
      describe: () => ({ ...gateway.describe(), mode: 'live', environmentKind: 'sandbox' }) as ReturnType<MediaGateway['describe']>,
      readProductMediaSignatures: () => Promise.reject(new Error('must not be called')),
      readProductMediaBytes: () => Promise.reject(new Error('must not be called')),
    };
    await expect(makeService({ gateway: live }).run()).rejects.toThrow(/read scope/);
  });
});

describe('ProductMediaSyncService: object verification', () => {
  it('re-stores a missing object of an unchanged product when verification is on', async () => {
    const bytes = syntheticProductImage('png', 900, 1);
    images.set(A, bytes);
    await makeService().run();
    await store.delete(keyOf(A, bytes));
    const result = await makeService().run();
    expect(result.stats).toMatchObject({ repaired: 1, unchanged: 0, created: 0 });
    expect(await store.has(keyOf(A, bytes))).toBe(true);
  });

  it('counts a re-stored missing object as repaired also under forceVerify', async () => {
    const bytes = syntheticProductImage('png', 900, 1);
    images.set(A, bytes);
    await makeService().run();
    await store.delete(keyOf(A, bytes));
    const result = await makeService().run({ forceVerify: true });
    expect(result.stats).toMatchObject({ repaired: 1, unchanged: 0, created: 0, updated: 0 });
    expect(await store.has(keyOf(A, bytes))).toBe(true);
  });

  it('leaves a missing object alone when verification is off', async () => {
    const bytes = syntheticProductImage('png', 900, 1);
    images.set(A, bytes);
    await makeService().run();
    await store.delete(keyOf(A, bytes));
    gateway.byteCalls.length = 0;
    const result = await makeService({ verifyObjects: false }).run();
    expect(result.stats).toMatchObject({ unchanged: 1, repaired: 0 });
    expect(gateway.byteCalls).toEqual([]);
    expect(await store.has(keyOf(A, bytes))).toBe(false);
  });
});

describe('ProductMediaSyncService: dry run, limit, concurrency, scope, prune', () => {
  it('a dry run reports what it would download and writes nothing anywhere', async () => {
    images.set(A, syntheticProductImage('png', 700, 1));
    images.set(B, syntheticProductImage('png', 700, 2));
    const result = await makeService().run({ dryRun: true });
    expect(result).toMatchObject({ dryRun: true, complete: true });
    expect(result.stats).toMatchObject({ examined: 2, wouldDownload: 2, created: 0 });
    expect(gateway.byteCalls).toEqual([]);
    expect(await rowOf(A)).toBeUndefined();
    expect(await database.handle.db.select().from(syncState).where(eq(syncState.entity, PRODUCT_MEDIA_ENTITY))).toEqual([]);
  });

  it('limit examines at most N products and the run is not complete', async () => {
    for (const code of CODES) images.set(code, syntheticProductImage('png', 300, code));
    const result = await makeService({ pageSize: 2 }).run({ limit: 3 });
    expect(result.stats).toMatchObject({ examined: 3, created: 3 });
    expect(result.complete).toBe(false);
    expect(await rowOf(CODES[3]!)).toBeUndefined();
  });

  it('refuses prune together with a limit (a partial listing cannot decide what is gone)', async () => {
    await expect(makeService().run({ limit: 2, prune: true })).rejects.toThrow(RangeError);
  });

  it('downloads concurrently without losing or duplicating work', async () => {
    for (const code of CODES) images.set(code, syntheticProductImage('png', 300, code));
    const result = await makeService().run({ concurrency: 4 });
    expect(result.stats).toMatchObject({ created: CODES.length, failed: 0 });
    expect([...new Set(gateway.byteCalls)].sort()).toEqual([...CODES].sort());
    expect(gateway.byteCalls).toHaveLength(CODES.length);
  });

  it('prune removes the row and object of a product whose photo is gone, and keeps the others', async () => {
    const goneBytes = syntheticProductImage('png', 700, 1);
    images.set(X, goneBytes);
    images.set(Y, syntheticProductImage('png', 700, 2));
    await makeService().run();
    images.delete(X);
    const kept = await makeService().run();
    expect(kept.stats).toMatchObject({ pruned: 0 });
    expect(await rowOf(X)).toBeDefined();
    const pruned = await pruneService().run({ prune: true });
    expect(pruned.stats).toMatchObject({ pruned: 1 });
    expect(pruned.prune).toMatchObject({ candidates: 1, total: 2, refusal: null });
    expect(await rowOf(X)).toBeUndefined();
    expect(await store.has(keyOf(X, goneBytes))).toBe(false);
    expect(await rowOf(Y)).toMatchObject({ status: 'stored' });
  });

  it('prune in dry-run mode only counts and reports the candidates', async () => {
    images.set(X, syntheticProductImage('png', 700, 1));
    images.set(Y, syntheticProductImage('png', 700, 2));
    await makeService().run();
    images.delete(X);
    const result = await pruneService().run({ prune: true, dryRun: true });
    expect(result.stats).toMatchObject({ pruned: 1 });
    expect(result.prune).toMatchObject({ candidates: 1, total: 2, refusal: null });
    expect(await rowOf(X)).toBeDefined();
  });

  it('prune is refused outright when the gateway is not live (a fake or empty source would delete real photos)', async () => {
    images.set(X, syntheticProductImage('png', 700, 1));
    await makeService().run();
    await expect(makeService().run({ prune: true })).rejects.toMatchObject({ name: 'PermanentJobError' });
    expect(await rowOf(X)).toBeDefined();
  });

  it('prune never runs on an empty listing, even with allowLargePrune; the run itself is recorded as succeeded', async () => {
    images.set(X, syntheticProductImage('png', 700, 1));
    await makeService().run();
    images.delete(X);
    await expect(pruneService().run({ prune: true, allowLargePrune: true })).rejects.toMatchObject({ name: 'PruneRefusedError' });
    expect(await rowOf(X)).toBeDefined();
    const [state] = await database.handle.db.select().from(syncState).where(eq(syncState.entity, PRODUCT_MEDIA_ENTITY));
    expect(state).toMatchObject({ status: 'succeeded' });
    const dry = await pruneService().run({ prune: true, dryRun: true });
    expect(dry.prune?.refusal).toMatch(/empty/);
  });

  it('prune that would remove more than half of the stored rows is refused unless allowLargePrune', async () => {
    for (const code of [X, Y, Z]) images.set(code, syntheticProductImage('png', 700, code));
    await makeService().run();
    images.delete(Y);
    images.delete(Z);
    await expect(pruneService().run({ prune: true })).rejects.toMatchObject({ name: 'PruneRefusedError' });
    expect(await rowOf(Y)).toBeDefined();
    expect(await rowOf(Z)).toBeDefined();
    const dry = await pruneService().run({ prune: true, dryRun: true });
    expect(dry.prune).toMatchObject({ candidates: 2, total: 3 });
    expect(dry.prune?.refusal).toMatch(/50%/);
    const allowed = await pruneService().run({ prune: true, allowLargePrune: true });
    expect(allowed.stats).toMatchObject({ pruned: 2 });
    expect(await rowOf(Y)).toBeUndefined();
    expect(await rowOf(X)).toBeDefined();
  });

  it('a product that left the read scope is left alone, unless pruned', async () => {
    const active = dataset.products.filter((p) => p.active && p.usageCode !== null);
    const inScope = active[0]!;
    const outOfScope = active.find((p) => p.usageCode !== inScope.usageCode)!;
    images.set(inScope.code, syntheticProductImage('png', 700, 1));
    images.set(outOfScope.code, syntheticProductImage('png', 700, 2));
    await makeService().run();
    const scope = (): Promise<ReadScope> => Promise.resolve({ products: { usageValues: [inScope.usageCode as string], activeOnly: true } });
    const result = await makeService({ readScope: scope }).run();
    expect(result.stats).toMatchObject({ examined: 1 });
    expect(await rowOf(outOfScope.code)).toBeDefined();
    const pruned = await makeService({ readScope: scope, gateway: liveLabelled(gateway) }).run({ prune: true });
    expect(pruned.stats).toMatchObject({ pruned: 1 });
    expect(await rowOf(outOfScope.code)).toBeUndefined();
    expect(await rowOf(inScope.code)).toBeDefined();
  });
});

describe('ProductMediaSyncService: targeted run (productCodes, --codprod)', () => {
  it('processes exactly the requested product, leaves the others untouched and is a partial run', async () => {
    for (const code of CODES) images.set(code, syntheticProductImage('png', 700, code));
    const result = await makeService().run({ productCodes: [B] });
    expect(result.stats).toMatchObject({ examined: 1, created: 1, failed: 0, thumbnailsGenerated: 1 });
    expect(result).toMatchObject({ complete: false, missingCodes: [] });
    expect(gateway.byteCalls).toEqual([B]);
    expect(await rowOf(B)).toBeDefined();
    expect(await rowOf(A)).toBeUndefined();
    expect(await rowOf(C)).toBeUndefined();
  });

  it('is idempotent: a second targeted run changes nothing and downloads nothing', async () => {
    images.set(B, syntheticProductImage('png', 700, 1));
    await makeService().run({ productCodes: [B] });
    gateway.byteCalls.length = 0;
    const again = await makeService().run({ productCodes: [B] });
    expect(again.stats).toMatchObject({ examined: 1, created: 0, updated: 0, unchanged: 1 });
    expect(gateway.byteCalls).toEqual([]);
  });

  it('handles several codes, ignores duplicates and reports a code the scoped listing does not return', async () => {
    images.set(A, syntheticProductImage('png', 700, 1));
    images.set(C, syntheticProductImage('png', 700, 3));
    const unknown = Math.max(...dataset.products.map((p) => p.code)) + 1000;
    const result = await makeService().run({ productCodes: [C, A, C, unknown] });
    expect(result.stats).toMatchObject({ examined: 2, created: 2 });
    expect(result.missingCodes).toEqual([unknown]);
    expect(await rowOf(A)).toBeDefined();
    expect(await rowOf(C)).toBeDefined();
    expect(await rowOf(B)).toBeUndefined();
  });

  it('respects the read scope: a product outside it is reported missing and never downloaded', async () => {
    const active = dataset.products.filter((p) => p.active && p.usageCode !== null);
    const inScope = active[0]!;
    const outOfScope = active.find((p) => p.usageCode !== inScope.usageCode)!;
    images.set(inScope.code, syntheticProductImage('png', 700, 1));
    images.set(outOfScope.code, syntheticProductImage('png', 700, 2));
    const scope = (): Promise<ReadScope> => Promise.resolve({ products: { usageValues: [inScope.usageCode as string], activeOnly: true } });
    const result = await makeService({ readScope: scope }).run({ productCodes: [inScope.code, outOfScope.code] });
    expect(result.stats).toMatchObject({ examined: 1, created: 1 });
    expect(result.missingCodes).toEqual([outOfScope.code]);
    expect(await rowOf(outOfScope.code)).toBeUndefined();
    expect(gateway.byteCalls).toEqual([inScope.code]);
  });

  it('a dry run reports what it would do and writes nothing', async () => {
    images.set(A, syntheticProductImage('png', 700, 1));
    images.set(B, syntheticProductImage('png', 700, 2));
    const result = await makeService().run({ productCodes: [A], dryRun: true });
    expect(result.stats).toMatchObject({ examined: 1, wouldDownload: 1, created: 0 });
    expect(gateway.byteCalls).toEqual([]);
    expect(await rowOf(A)).toBeUndefined();
    expect(await database.handle.db.select().from(syncState).where(eq(syncState.entity, PRODUCT_MEDIA_ENTITY))).toEqual([]);
  });

  it('forceVerify downloads the targeted product again even though its signature did not change', async () => {
    images.set(A, syntheticProductImage('png', 700, 1));
    images.set(B, syntheticProductImage('png', 700, 2));
    await makeService().run({ productCodes: [A, B] });
    gateway.byteCalls.length = 0;
    const result = await makeService().run({ productCodes: [A], forceVerify: true });
    expect(result.stats).toMatchObject({ examined: 1, created: 0, updated: 0 });
    expect(gateway.byteCalls).toEqual([A]);
  });

  it('never marks the catalog as fully reconciled', async () => {
    images.set(A, syntheticProductImage('png', 700, 1));
    await makeService().run({ productCodes: [A] });
    const [state] = await database.handle.db.select().from(syncState).where(eq(syncState.entity, PRODUCT_MEDIA_ENTITY));
    expect(state?.lastFullReconcileAt ?? null).toBeNull();
    expect(JSON.stringify(state?.cursor)).toMatch(/"complete":false/);
  });

  it('looks each code up with the gateway scoped keyset read, one product per call', async () => {
    images.set(A, syntheticProductImage('png', 700, 1));
    images.set(B, syntheticProductImage('png', 700, 2));
    await makeService().run({ productCodes: [A, B] });
    expect(gateway.signatureCalls).toBe(2);
  });

  it.each([
    ['an empty list', { productCodes: [] as number[] }],
    ['zero', { productCodes: [0] }],
    ['a negative code', { productCodes: [-5] }],
    ['a fraction', { productCodes: [1.5] }],
    ['NaN', { productCodes: [Number.NaN] }],
    ['an unsafe integer', { productCodes: [Number.MAX_SAFE_INTEGER + 1] }],
    ['more than 50 codes', { productCodes: Array.from({ length: 51 }, (_, i) => i + 1) }],
    ['a limit', { productCodes: [1], limit: 1 }],
    ['a prune', { productCodes: [1], prune: true }],
  ])('refuses %s before anything is read or recorded', async (_label, options) => {
    await expect(makeService().run(options)).rejects.toThrow(RangeError);
    expect(gateway.signatureCalls).toBe(0);
    expect(await database.handle.db.select().from(syncState).where(eq(syncState.entity, PRODUCT_MEDIA_ENTITY))).toEqual([]);
  });
});

describe('ProductMediaSyncService: operational record', () => {
  it('writes a reserved worker.* sync_state row with counters only (no names, no bytes), hidden from the mirror summary', async () => {
    images.set(A, syntheticProductImage('png', 700, 1));
    await makeService().run();
    const [state] = await database.handle.db.select().from(syncState).where(eq(syncState.entity, PRODUCT_MEDIA_ENTITY));
    expect(isReservedSyncEntity(PRODUCT_MEDIA_ENTITY)).toBe(true);
    expect(state).toMatchObject({ status: 'succeeded', rowCount: 1, lastErrorClass: null });
    expect(JSON.stringify(state?.cursor)).toMatch(/"created":1/);
    expect(JSON.stringify(state)).not.toMatch(/product-images|\/tmp/);
  });
});

const thumbKeyOf = async (code: number): Promise<string> => {
  const key = (await rowOf(code))?.thumbnailStorageKey;
  if (key == null) throw new Error('row has no thumbnail');
  return key;
};

const NO_THUMBNAIL = { thumbnailStorageKey: null, thumbnailContentType: null, thumbnailByteLength: null, thumbnailContentHash: null, thumbnailGeneratedAt: null };
const makeLegacy = async (code: number): Promise<void> => {
  await database.handle.db.update(productMedia).set(NO_THUMBNAIL).where(eq(productMedia.productCode, code));
};

describe('ProductMediaSyncService: thumbnails', () => {
  it('renders one thumbnail per stored photo, stores it content-addressed and writes original and thumbnail metadata together', async () => {
    const bytes = syntheticProductImage('jpeg', 3000, 1);
    images.set(A, bytes);
    const result = await makeService().run();
    const row = await rowOf(A);
    expect(row).toMatchObject({ status: 'stored', thumbnailContentType: 'image/webp' });
    const thumb = (await store.get(await thumbKeyOf(A))) as Uint8Array;
    expect(thumb).not.toBeNull();
    expect(await thumbKeyOf(A)).toBe(`product-thumbnails/${A}/${sha256(thumb)}`);
    expect(row?.thumbnailContentHash).toBe(sha256(thumb));
    expect(row?.thumbnailByteLength).toBe(thumb.length);
    expect(result.stats).toMatchObject({ created: 1, thumbnailsGenerated: 1, thumbnailsReused: 0, thumbnailFailed: 0, thumbnailBytes: thumb.length });
    expect([...((await store.get(keyOf(A, bytes))) ?? [])]).toEqual([...bytes]); // the original is byte-identical
  });

  it('a second run with nothing changed renders nothing, reads no bytes and writes nothing', async () => {
    images.set(A, syntheticProductImage('png', 2000, 1));
    await makeService().run();
    const before = await rowOf(A);
    renderer.calls.length = 0;
    gateway.byteCalls.length = 0;
    const result = await makeService().run();
    expect(result.stats).toMatchObject({ unchanged: 1, thumbnailsReused: 1, thumbnailsGenerated: 0, thumbnailFailed: 0 });
    expect(renderer.calls).toEqual([]);
    expect(gateway.byteCalls).toEqual([]);
    expect(await rowOf(A)).toEqual(before);
  });

  it('forceVerify re-downloads but keeps the existing thumbnail (reused, not re-rendered)', async () => {
    images.set(A, syntheticProductImage('png', 2000, 1));
    await makeService().run();
    const before = await rowOf(A);
    renderer.calls.length = 0;
    const result = await makeService().run({ forceVerify: true });
    expect(result.stats).toMatchObject({ unchanged: 1, thumbnailsReused: 1, thumbnailsGenerated: 0 });
    expect(renderer.calls).toEqual([]);
    expect((await rowOf(A))?.thumbnailGeneratedAt).toEqual(before?.thumbnailGeneratedAt);
  });

  it('a changed original gets a new thumbnail and the superseded thumbnail object is removed', async () => {
    images.set(A, syntheticProductImage('png', 2000, 1));
    await makeService().run();
    const oldKey = await thumbKeyOf(A);
    images.set(A, syntheticProductImage('png', 2500, 9));
    const result = await makeService().run();
    expect(result.stats).toMatchObject({ updated: 1, thumbnailsGenerated: 1 });
    const newKey = await thumbKeyOf(A);
    expect(newKey).not.toBe(oldKey);
    expect(await store.has(newKey)).toBe(true);
    expect(await store.has(oldKey)).toBe(false);
  });

  it('a deleted thumbnail object is regenerated from the stored original without calling the ERP, and counted as repaired', async () => {
    images.set(A, syntheticProductImage('png', 2000, 1));
    await makeService().run();
    const key = await thumbKeyOf(A);
    await store.delete(key);
    gateway.byteCalls.length = 0;
    const result = await makeService().run();
    expect(result.stats).toMatchObject({ repaired: 1, thumbnailsGenerated: 1, unchanged: 0 });
    expect(gateway.byteCalls).toEqual([]);
    expect(await store.has(key)).toBe(true);
    expect(await thumbKeyOf(A)).toBe(key);
  });

  it('with verification off a missing thumbnail object is left alone (like the original)', async () => {
    images.set(A, syntheticProductImage('png', 2000, 1));
    await makeService().run();
    await store.delete(await thumbKeyOf(A));
    renderer.calls.length = 0;
    const result = await makeService({ verifyObjects: false }).run();
    expect(result.stats).toMatchObject({ unchanged: 1, repaired: 0, thumbnailsGenerated: 0 });
    expect(renderer.calls).toEqual([]);
  });

  it('backfills a legacy row (stored, no thumbnail) from the object store with NO ERP byte call', async () => {
    const bytes = syntheticProductImage('jpeg', 2000, 3);
    images.set(A, bytes);
    await makeService().run();
    const key = await thumbKeyOf(A);
    await makeLegacy(A); // the thumbnail record disappears, the original stays
    await store.delete(key);
    gateway.byteCalls.length = 0;
    const result = await makeService({ verifyObjects: false }).run();
    expect(gateway.byteCalls).toEqual([]);
    expect(result.stats).toMatchObject({ thumbnailsGenerated: 1, repaired: 0, unchanged: 0, created: 0, failed: 0 });
    expect((await rowOf(A))?.thumbnailStorageKey).toBe(key);
    expect(await store.has(key)).toBe(true);
    expect((await rowOf(A))?.contentHash).toBe(sha256(bytes));
  });

  it('a legacy row whose stored original is gone is downloaded again, thumbnail included', async () => {
    const bytes = syntheticProductImage('png', 1800, 4);
    images.set(A, bytes);
    await makeService().run();
    await makeLegacy(A);
    await store.delete(keyOf(A, bytes));
    gateway.byteCalls.length = 0;
    const result = await makeService({ verifyObjects: false }).run();
    expect(gateway.byteCalls).toEqual([A]);
    expect(result.stats).toMatchObject({ thumbnailsGenerated: 1, failed: 0 });
    expect(await store.has(keyOf(A, bytes))).toBe(true);
    expect((await rowOf(A))?.thumbnailStorageKey).not.toBeNull();
  });

  it('a renderer failure is isolated: the original stays stored, the others continue, the next run retries from the store', async () => {
    const a = syntheticProductImage('png', 1500, 1);
    images.set(A, a);
    images.set(B, syntheticProductImage('png', 1500, 2));
    renderer.failWhen = (original) => (sha256(original) === sha256(a) ? new Error('transient render crash') : null);
    const result = await makeService().run();
    expect(result.stats).toMatchObject({ created: 2, failed: 0, thumbnailFailed: 1, thumbnailsGenerated: 1 });
    expect(await rowOf(A)).toMatchObject({ status: 'stored', failureReason: 'thumbnail_failed', thumbnailStorageKey: null, contentHash: sha256(a) });
    expect(await store.has(keyOf(A, a))).toBe(true);
    expect(await rowOf(B)).toMatchObject({ status: 'stored', failureReason: null });

    gateway.byteCalls.length = 0;
    renderer.failWhen = null;
    const retry = await makeService().run();
    expect(gateway.byteCalls).toEqual([]);
    expect(retry.stats).toMatchObject({ thumbnailsGenerated: 1, thumbnailFailed: 0, unchanged: 1 });
    expect(await rowOf(A)).toMatchObject({ failureReason: null, failureCount: 0 });
    expect((await rowOf(A))?.thumbnailStorageKey).not.toBeNull();
  });

  it('a renderer that keeps failing is retried every run but never blocks anything else', async () => {
    images.set(A, syntheticProductImage('png', 1500, 1));
    renderer.failWith = new Error('native crash detail with /secret/path');
    await makeService().run();
    const second = await makeService().run();
    expect(second.stats).toMatchObject({ thumbnailFailed: 1, failed: 0 });
    expect(await rowOf(A)).toMatchObject({ status: 'stored', failureReason: 'thumbnail_failed', failureCount: 2 });
  });

  it('records a rendition above the size bound as thumbnail_too_large, and refuses an empty or non-WebP rendition from any renderer', async () => {
    images.set(A, syntheticProductImage('png', 1500, 1));
    renderer.failWith = renderFailure('output_too_large');
    await makeService().run();
    expect(await rowOf(A)).toMatchObject({ status: 'stored', failureReason: 'thumbnail_too_large', thumbnailStorageKey: null });
    renderer.failWith = null;

    // thumbnail_too_large is parked: the later attempts need forceVerify.
    renderer.outputOverride = new Uint8Array(THUMBNAIL_MAX_BYTES + 1);
    expect((await makeService().run({ forceVerify: true })).stats).toMatchObject({ thumbnailFailed: 1 });
    expect(await rowOf(A)).toMatchObject({ failureReason: 'thumbnail_too_large', thumbnailStorageKey: null });
    renderer.outputOverride = new Uint8Array(0);
    await makeService().run({ forceVerify: true });
    expect(await rowOf(A)).toMatchObject({ failureReason: 'thumbnail_failed', thumbnailStorageKey: null });
    renderer.outputOverride = syntheticProductImage('png', 400, 1);
    await makeService().run();
    expect(await rowOf(A)).toMatchObject({ failureReason: 'thumbnail_failed', thumbnailStorageKey: null });
    expect((await readdir(root, { recursive: true })).some((entry) => entry.includes('product-thumbnails'))).toBe(false);
  });

  it('a dry run reports how many thumbnails it would render and writes nothing', async () => {
    images.set(A, syntheticProductImage('png', 1500, 1));
    await makeService().run();
    await makeLegacy(A);
    renderer.calls.length = 0;
    const before = await rowOf(A);
    const result = await makeService().run({ dryRun: true });
    expect(result.stats).toMatchObject({ wouldGenerateThumbnails: 1, thumbnailsGenerated: 0, wouldDownload: 0 });
    expect(renderer.calls).toEqual([]);
    expect(await rowOf(A)).toEqual(before);
  });

  it('a product without a photo in the ERP is simply not examined', async () => {
    images.set(B, syntheticProductImage('png', 1500, 2));
    const result = await makeService().run();
    expect(result.stats).toMatchObject({ examined: 1, thumbnailsGenerated: 1 });
    expect(await rowOf(A)).toBeUndefined();
  });

  it('a refresh that fails drops the thumbnail record (the schema allows one only on a stored row) and keeps the original', async () => {
    const good = syntheticProductImage('png', 1200, 1);
    images.set(A, good);
    await makeService().run();
    images.set(A, HTML_BYTES);
    await makeService().run();
    expect(await rowOf(A)).toMatchObject({ status: 'failed', contentHash: sha256(good), thumbnailStorageKey: null });
  });

  it('counts the reuse of a verified thumbnail in the plain unchanged branch, with or without object verification', async () => {
    images.set(A, syntheticProductImage('png', 2000, 1));
    await makeService().run();
    expect((await makeService().run()).stats).toMatchObject({ unchanged: 1, thumbnailsReused: 1, thumbnailsGenerated: 0, repaired: 0 });
    expect((await makeService({ verifyObjects: false }).run()).stats).toMatchObject({ unchanged: 1, thumbnailsReused: 1, thumbnailsGenerated: 0 });
  });

  it('forceVerify on a legacy row (stored, no thumbnail) is a backfill: the thumbnail is generated, nothing is "unchanged"', async () => {
    const bytes = syntheticProductImage('png', 2000, 1);
    images.set(A, bytes);
    await makeService().run();
    await makeLegacy(A);
    gateway.byteCalls.length = 0;
    const result = await makeService().run({ forceVerify: true });
    expect(gateway.byteCalls).toEqual([A]);
    expect(result.stats).toMatchObject({ unchanged: 0, repaired: 0, created: 0, updated: 0, thumbnailsGenerated: 1, thumbnailsReused: 0, failed: 0 });
    expect((await rowOf(A))?.thumbnailStorageKey).not.toBeNull();
    expect(await store.has(keyOf(A, bytes))).toBe(true);
  });

  it('a lowered PRODUCT_MEDIA_MAX_BYTES never deletes a good stored original: the legacy row is backfilled from the intact object', async () => {
    const bytes = syntheticProductImage('jpeg', 3000, 1);
    images.set(A, bytes);
    await makeService().run();
    await makeLegacy(A);
    gateway.byteCalls.length = 0;
    expect(bytes.length).toBeGreaterThan(1024);
    const result = await makeService({ maxBytes: 1024, verifyObjects: false }).run();
    expect(gateway.byteCalls).toEqual([]);
    expect(result.stats).toMatchObject({ thumbnailsGenerated: 1, failed: 0 });
    expect([...((await store.get(keyOf(A, bytes))) ?? [])]).toEqual([...bytes]);
    expect(await rowOf(A)).toMatchObject({ status: 'stored', contentHash: sha256(bytes), storageKey: keyOf(A, bytes) });
  });

  it('a lowered cap with a legacy row whose original is damaged: nothing is deleted before a replacement is stored, the refusal is recorded and the object stays', async () => {
    const bytes = syntheticProductImage('jpeg', 3000, 1);
    images.set(A, bytes);
    await makeService().run();
    await makeLegacy(A);
    const key = keyOf(A, bytes);
    const garbage = new Uint8Array(bytes.length).fill(9);
    await store.put(key, garbage); // same size, other content: hash mismatch
    gateway.byteCalls.length = 0;
    const result = await makeService({ maxBytes: 1024, verifyObjects: false }).run();
    expect(gateway.byteCalls).toEqual([]); // announced size above the cap: refused without a download
    expect(result.stats).toMatchObject({ failed: 1, thumbnailsGenerated: 0 });
    expect(await store.has(key)).toBe(true);
    expect([...((await store.get(key)) ?? [])]).toEqual([...garbage]);
    expect(await rowOf(A)).toMatchObject({ status: 'failed', failureReason: 'media_too_large', storageKey: key, contentHash: sha256(bytes) });
    // A truncated object (size mismatch) behaves the same.
    await store.put(key, bytes.slice(0, 100));
    await makeService({ maxBytes: 1024, verifyObjects: false }).run({ forceVerify: true });
    expect(await store.has(key)).toBe(true);
    expect(await rowOf(A)).toMatchObject({ status: 'failed', failureReason: 'media_too_large', storageKey: key, contentHash: sha256(bytes) });
  });

  it('a damaged stored original (hash mismatch) is overwritten by a fresh download, only after the download succeeded', async () => {
    const bytes = syntheticProductImage('png', 2000, 1);
    images.set(A, bytes);
    await makeService().run();
    await makeLegacy(A);
    const key = keyOf(A, bytes);
    await store.put(key, new Uint8Array(bytes.length).fill(5));
    gateway.byteCalls.length = 0;
    const result = await makeService({ verifyObjects: false }).run();
    expect(gateway.byteCalls).toEqual([A]);
    expect(result.stats).toMatchObject({ repaired: 1, thumbnailsGenerated: 1, failed: 0 });
    expect([...((await store.get(key)) ?? [])]).toEqual([...bytes]);
  });

  it.each([
    ['decode_failed', 'decode_failed'],
    ['animated', 'animated'],
    ['too_many_pixels', 'too_many_pixels'],
    ['unsupported_format', 'unsupported_format'],
    ['output_too_large', 'thumbnail_too_large'],
  ] as const)('a permanent thumbnail failure (%s) is parked while the original is unchanged, and retried on forceVerify or a changed original', async (code, reason) => {
    images.set(A, syntheticProductImage('png', 1500, 1));
    renderer.failWith = renderFailure(code);
    const first = await makeService().run();
    expect(first.stats).toMatchObject({ created: 1, thumbnailFailed: 1 });
    expect(await rowOf(A)).toMatchObject({ status: 'stored', failureReason: reason, failureCount: 1, thumbnailStorageKey: null });

    renderer.calls.length = 0;
    gateway.byteCalls.length = 0;
    for (let run = 0; run < 3; run += 1) {
      const parked = await makeService().run();
      expect(parked.stats).toMatchObject({ skippedPermanent: 1, thumbnailFailed: 0, thumbnailsGenerated: 0, unchanged: 0, failed: 0 });
    }
    expect(renderer.calls).toEqual([]);
    expect(gateway.byteCalls).toEqual([]);
    expect(await rowOf(A)).toMatchObject({ failureReason: reason, failureCount: 1 });

    const forced = await makeService().run({ forceVerify: true });
    expect(forced.stats).toMatchObject({ thumbnailFailed: 1, skippedPermanent: 0 });
    expect(renderer.calls).toHaveLength(1);
    expect(await rowOf(A)).toMatchObject({ failureReason: reason, failureCount: 1 });

    renderer.failWith = null;
    images.set(A, syntheticProductImage('png', 2500, 9)); // changed original: retried without force
    const changed = await makeService().run();
    expect(changed.stats).toMatchObject({ updated: 1, thumbnailsGenerated: 1, thumbnailFailed: 0 });
    expect(await rowOf(A)).toMatchObject({ failureReason: null, failureCount: 0 });
    expect((await rowOf(A))?.thumbnailStorageKey).not.toBeNull();
  });

  it('a parked legacy row (stored, no thumbnail) is also left alone, and forceVerify retries it', async () => {
    images.set(A, syntheticProductImage('png', 1500, 1));
    renderer.failWith = renderFailure('decode_failed');
    await makeService().run();
    renderer.failWith = null;
    renderer.calls.length = 0;
    expect((await makeService().run()).stats).toMatchObject({ skippedPermanent: 1 });
    expect(renderer.calls).toEqual([]);
    expect((await makeService().run({ forceVerify: true })).stats).toMatchObject({ thumbnailsGenerated: 1, unchanged: 0 });
    expect(await rowOf(A)).toMatchObject({ failureReason: null, failureCount: 0 });
  });

  it('a corrupted thumbnail object (sha256 differs from the record) is deleted and rendered again, without any ERP call', async () => {
    images.set(A, syntheticProductImage('png', 2000, 1));
    await makeService().run();
    const key = await thumbKeyOf(A);
    const recorded = (await rowOf(A))?.thumbnailContentHash;
    const original = (await store.get(key)) as Uint8Array;
    for (const damaged of [new Uint8Array(original.length).fill(1), original.slice(0, 10), new Uint8Array(original.length + 5).fill(2)]) {
      await store.put(key, damaged);
      gateway.byteCalls.length = 0;
      const result = await makeService().run();
      expect(gateway.byteCalls).toEqual([]);
      expect(result.stats).toMatchObject({ repaired: 1, thumbnailsGenerated: 1, unchanged: 0, thumbnailsReused: 0 });
      expect(sha256((await store.get(key)) as Uint8Array)).toBe(recorded);
      expect((await rowOf(A))?.thumbnailContentHash).toBe(recorded);
    }
    // forceVerify takes the same decision on a corrupted thumbnail.
    await store.put(key, new Uint8Array(original.length).fill(3));
    const forced = await makeService().run({ forceVerify: true });
    expect(forced.stats).toMatchObject({ repaired: 1, thumbnailsGenerated: 1, unchanged: 0 });
    expect(sha256((await store.get(key)) as Uint8Array)).toBe(recorded);
    // A damaged object is not repaired when verification is off (like a missing one).
    await store.put(key, new Uint8Array(original.length).fill(4));
    renderer.calls.length = 0;
    expect((await makeService({ verifyObjects: false }).run()).stats).toMatchObject({ unchanged: 1, thumbnailsGenerated: 0 });
    expect(renderer.calls).toEqual([]);
  });

  it('prune removes the thumbnail object together with the original', async () => {
    images.set(X, syntheticProductImage('png', 700, 1));
    images.set(Y, syntheticProductImage('png', 700, 2));
    await makeService().run();
    const key = await thumbKeyOf(X);
    images.delete(X);
    await pruneService().run({ prune: true });
    expect(await store.has(key)).toBe(false);
  });
});

describe('ProductMediaSyncService: thumbnails with the real renderer (sharp)', () => {
  const real = new SharpThumbnailRenderer();
  const BIG = 6 * 1024 * 1024;

  it.each(['png', 'jpeg', 'webp'] as const)('a %s original gives a 256 px WebP thumbnail with the aspect ratio kept; the original is stored byte-identical', async (format) => {
    const original = await realImage(format, 900, 600, { noisy: true });
    images.set(A, original);
    const result = await makeService({ renderer: real, maxBytes: BIG }).run();
    expect(result.stats).toMatchObject({ created: 1, thumbnailsGenerated: 1, thumbnailFailed: 0 });
    const row = await rowOf(A);
    const thumb = (await store.get(await thumbKeyOf(A))) as Uint8Array;
    const m = await sharp(Buffer.from(thumb)).metadata();
    expect([m.format, m.width, m.height]).toEqual(['webp', 256, 171]);
    expect(row?.thumbnailContentHash).toBe(sha256(thumb));
    expect(row?.thumbnailContentType).toBe('image/webp');
    expect(row?.thumbnailByteLength).toBe(thumb.length);
    expect(Buffer.compare(Buffer.from((await store.get(keyOf(A, original))) as Uint8Array), Buffer.from(original))).toBe(0);
  });

  it('a small original is not upscaled', async () => {
    images.set(A, await realImage('png', 120, 80));
    await makeService({ renderer: real }).run();
    const m = await sharp(Buffer.from((await store.get(await thumbKeyOf(A))) as Uint8Array)).metadata();
    expect([m.width, m.height]).toEqual([120, 80]);
  });

  it('originals above 256 KiB and above 1 MiB both get a thumbnail far below 256 KiB', async () => {
    const mid = await realImage('jpeg', 700, 700, { noisy: true, seed: 3 });
    const large = await realImage('jpeg', 1800, 1300, { noisy: true, seed: 4 });
    expect(mid.length).toBeGreaterThan(256 * 1024);
    expect(large.length).toBeGreaterThan(1024 * 1024);
    images.set(A, mid);
    images.set(B, large);
    const result = await makeService({ renderer: real, maxBytes: BIG }).run();
    expect(result.stats).toMatchObject({ created: 2, thumbnailsGenerated: 2, thumbnailFailed: 0 });
    for (const code of [A, B]) {
      const row = await rowOf(code);
      expect(row?.thumbnailByteLength).toBeLessThanOrEqual(THUMBNAIL_MAX_BYTES);
      expect(row?.thumbnailByteLength).toBeGreaterThan(0);
    }
    expect((await rowOf(B))?.byteLength).toBe(large.length);
  });

  it('an image sharp cannot decode keeps its original and records decode_failed (structurally valid bytes are not enough)', async () => {
    images.set(A, syntheticProductImage('png', 1500, 1));
    const result = await makeService({ renderer: real }).run();
    expect(result.stats).toMatchObject({ created: 1, thumbnailFailed: 1, thumbnailsGenerated: 0 });
    expect(await rowOf(A)).toMatchObject({ status: 'stored', failureReason: 'decode_failed', thumbnailStorageKey: null });
  });

  it('a changed original replaces the thumbnail, and an unchanged one is not re-rendered', async () => {
    images.set(A, await realImage('jpeg', 800, 600, { noisy: true, seed: 1 }));
    await makeService({ renderer: real, maxBytes: BIG }).run();
    const first = await rowOf(A);
    const again = await makeService({ renderer: real, maxBytes: BIG }).run();
    expect(again.stats).toMatchObject({ unchanged: 1, thumbnailsGenerated: 0 });
    images.set(A, await realImage('jpeg', 800, 600, { noisy: true, seed: 2 }));
    await makeService({ renderer: real, maxBytes: BIG }).run();
    const second = await rowOf(A);
    expect(second?.thumbnailContentHash).not.toBe(first?.thumbnailContentHash);
    expect(await store.has(first?.thumbnailStorageKey as string)).toBe(false);
  });
});
