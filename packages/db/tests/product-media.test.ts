import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, productMedia, runMigrations, type DbHandle } from '../src/index.js';
import { defaultMigrationsDir } from '../src/migrate/files.js';
import { startPostgres, type TestPostgres } from './helpers.js';

const quiet = { log: () => undefined };
const HASH = 'a'.repeat(64);
let pgc: TestPostgres;
let url: string;
let h: DbHandle;

beforeAll(async () => {
  pgc = await startPostgres();
  url = await pgc.createDatabase();
  await runMigrations(url, quiet);
  h = createDb(url);
});
afterAll(async () => {
  await h?.close();
  await pgc?.stop();
});

async function query<T extends pg.QueryResultRow>(u: string, text: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: u });
  await c.connect();
  try {
    return (await c.query<T>(text, params)).rows;
  } finally {
    await c.end();
  }
}

const stored = (code: number, over: Record<string, unknown> = {}) => ({
  productCode: code,
  status: 'stored',
  contentType: 'image/jpeg',
  byteLength: 1234,
  contentHash: HASH,
  storageKey: `product-images/${code}/${HASH}`,
  sourceLength: 1300,
  sourceFingerprint: 'f'.repeat(32),
  syncedAt: new Date(),
  ...over,
});

async function pgCode(p: Promise<unknown>): Promise<string | undefined> {
  const e = (await p.then(
    () => undefined,
    (x: unknown) => x,
  )) as { code?: string; cause?: { code?: string; constraint?: string }; constraint?: string } | undefined;
  return e?.cause?.constraint ?? e?.constraint;
}

describe('product_media', () => {
  it('accepts a valid stored row and a failed row without object data', async () => {
    await h.db.insert(productMedia).values(stored(1) as never);
    await h.db.insert(productMedia).values({ productCode: 2, status: 'failed', failureReason: 'source_too_large', failureCount: 1, lastAttemptAt: new Date() });
    const rows = await h.db.select().from(productMedia).where(eq(productMedia.productCode, 2));
    expect(rows[0]).toMatchObject({ status: 'failed', contentHash: null, failureCount: 1 });
  });

  it('rejects stored rows missing any required field', async () => {
    const required = ['contentType', 'byteLength', 'contentHash', 'storageKey', 'sourceLength', 'sourceFingerprint', 'syncedAt'];
    let code = 100;
    for (const f of required) {
      expect(await pgCode(h.db.insert(productMedia).values(stored(code++, { [f]: null }) as never))).toBe('product_media_stored_chk');
    }
  });

  it('rejects bad status, content type, hash, lengths, failure data', async () => {
    const bad = async (over: Record<string, unknown>) => pgCode(h.db.insert(productMedia).values(stored(500, over) as never));
    expect(await bad({ status: 'pending' })).toBe('product_media_status_chk');
    expect(await bad({ contentType: 'image/gif' })).toBe('product_media_content_type_chk');
    expect(await bad({ contentHash: 'a'.repeat(63) })).toBe('product_media_content_hash_chk');
    expect(await bad({ contentHash: 'A'.repeat(64) })).toBe('product_media_content_hash_chk');
    expect(await bad({ byteLength: 0 })).toBe('product_media_byte_length_chk');
    expect(await bad({ sourceLength: -1 })).toBe('product_media_source_length_chk');
    expect(await bad({ failureCount: -1 })).toBe('product_media_failure_count_chk');
    expect(await bad({ failureReason: '' })).toBe('product_media_failure_reason_chk');
    expect(await bad({ failureReason: 'x'.repeat(65) })).toBe('product_media_failure_reason_chk');
  });

  it('upserts by product code (store, then a failed attempt keeps the previous object)', async () => {
    await h.db.insert(productMedia).values(stored(600) as never);
    await h.db
      .insert(productMedia)
      .values({ productCode: 600, status: 'failed', failureReason: 'fetch_error', failureCount: 1 })
      .onConflictDoUpdate({
        target: productMedia.productCode,
        set: { status: 'failed', failureReason: 'fetch_error', failureCount: sql`${productMedia.failureCount} + 1`, updatedAt: new Date() },
      });
    const [row] = await h.db.select().from(productMedia).where(eq(productMedia.productCode, 600));
    expect(row).toMatchObject({ status: 'failed', failureCount: 1, contentHash: HASH, storageKey: `product-images/600/${HASH}` });
    expect(await h.db.select().from(productMedia).where(sql`${productMedia.productCode} = any(${sql.raw('array[600, 1, 99999]')})`)).toHaveLength(2);
  });

  it('has no FK to erp_product and no bytea column', async () => {
    expect(await query(url, `SELECT 1 FROM pg_constraint WHERE conrelid = 'product_media'::regclass AND contype = 'f'`)).toHaveLength(0);
    expect(await query(url, `SELECT 1 FROM information_schema.columns WHERE table_name = 'product_media' AND data_type = 'bytea'`)).toHaveLength(0);
  });

  it('0009 is expand-only: upgrading 0008 -> 0009 creates the table and leaves data untouched', async () => {
    const u = await pgc.createDatabase();
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sf-migrations-'));
    await cp(defaultMigrationsDir, dir, { recursive: true });
    const journalPath = path.join(dir, 'meta', '_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { entries: { tag: string }[] };
    journal.entries = journal.entries.filter((e) => e.tag !== '0009_product_media' && e.tag !== '0010_product_media_thumbnail');
    await writeFile(journalPath, JSON.stringify(journal));
    await runMigrations(u, { ...quiet, migrationsDir: dir });
    expect(await query(u, `SELECT to_regclass('public.product_media') AS t`)).toEqual([{ t: null }]);
    await query(u, `INSERT INTO erp_product (code, description, active, content_hash, synced_at) VALUES (7, 'P', true, 'h', now())`);

    const next = await runMigrations(u, quiet);
    expect(next.applied).toEqual(['0009_product_media', '0010_product_media_thumbnail']);
    expect(await query(u, `SELECT code FROM erp_product`)).toEqual([{ code: 7 }]);
    expect(await query(u, `SELECT count(*)::int AS n FROM product_media`)).toEqual([{ n: 0 }]);
  });

  describe('thumbnail columns (0010)', () => {
    const THUMB = {
      thumbnailStorageKey: `product-thumbnails/700/${HASH}`,
      thumbnailContentType: 'image/webp',
      thumbnailByteLength: 4096,
      thumbnailContentHash: 'b'.repeat(64),
      thumbnailGeneratedAt: new Date(),
    };
    const failed = (code: number, over: Record<string, unknown> = {}) => ({ productCode: code, status: 'failed', failureReason: 'fetch_error', ...over });

    it('accepts a stored row with no thumbnail (all NULL) and a full valid thumbnail', async () => {
      await h.db.insert(productMedia).values(stored(700));
      const [row] = await h.db.select().from(productMedia).where(eq(productMedia.productCode, 700));
      expect(row).toMatchObject({ thumbnailStorageKey: null, thumbnailContentType: null, thumbnailByteLength: null, thumbnailContentHash: null, thumbnailGeneratedAt: null });
      await h.db.update(productMedia).set(THUMB).where(eq(productMedia.productCode, 700));
      const [after] = await h.db.select().from(productMedia).where(eq(productMedia.productCode, 700));
      expect(after).toMatchObject({ thumbnailContentType: 'image/webp', thumbnailByteLength: 4096 });
    });

    it('rejects a partial thumbnail set (each of the four columns missing in turn)', async () => {
      const keys = ['thumbnailStorageKey', 'thumbnailContentType', 'thumbnailByteLength', 'thumbnailContentHash'] as const;
      let code = 710;
      for (const k of keys) {
        const partial = { ...THUMB, [k]: null };
        expect(await pgCode(h.db.insert(productMedia).values(stored(code++, partial)))).toBe('product_media_thumbnail_chk');
      }
      expect(await pgCode(h.db.insert(productMedia).values(stored(719, { thumbnailStorageKey: 'k' })))).toBe('product_media_thumbnail_chk');
    });

    it('rejects an invalid type, hash, length and key length', async () => {
      const bad: Record<string, unknown>[] = [
        { thumbnailContentType: 'image/gif' },
        { thumbnailContentHash: 'B'.repeat(64) },
        { thumbnailContentHash: 'b'.repeat(63) },
        { thumbnailByteLength: 0 },
        { thumbnailByteLength: -5 },
        { thumbnailStorageKey: '' },
        { thumbnailStorageKey: 'k'.repeat(513) },
      ];
      let code = 720;
      for (const over of bad) {
        expect(await pgCode(h.db.insert(productMedia).values(stored(code++, { ...THUMB, ...over })))).toBe('product_media_thumbnail_chk');
      }
      expect(await pgCode(h.db.insert(productMedia).values(stored(740, { ...THUMB, thumbnailStorageKey: 'k'.repeat(512), thumbnailContentType: 'image/png' })))).toBeUndefined();
    });

    it('rejects a thumbnail on a failed row; a failed row with all NULL stays valid', async () => {
      expect(await pgCode(h.db.insert(productMedia).values(failed(750, THUMB)))).toBe('product_media_thumbnail_chk');
      expect(await pgCode(h.db.insert(productMedia).values(failed(751)))).toBeUndefined();
    });

    it('0010 is expand-only: a stored row that exists at 0009 stays valid with NULL thumbnail columns', async () => {
      const u = await pgc.createDatabase();
      const dir = await mkdtemp(path.join(os.tmpdir(), 'sf-migrations-'));
      await cp(defaultMigrationsDir, dir, { recursive: true });
      const journalPath = path.join(dir, 'meta', '_journal.json');
      const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { entries: { tag: string }[] };
      journal.entries = journal.entries.filter((e) => e.tag !== '0010_product_media_thumbnail');
      await writeFile(journalPath, JSON.stringify(journal));
      await runMigrations(u, { ...quiet, migrationsDir: dir });
      await query(
        u,
        `INSERT INTO product_media (product_code, status, content_type, byte_length, content_hash, storage_key, source_length, source_fingerprint, synced_at)
         VALUES (800, 'stored', 'image/jpeg', 10, $1, 'k', 10, 'f', now()), (801, 'failed', NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
        [HASH],
      );
      const next = await runMigrations(u, quiet);
      expect(next.applied).toEqual(['0010_product_media_thumbnail']);
      expect(
        await query(u, `SELECT product_code, thumbnail_storage_key, thumbnail_content_type, thumbnail_byte_length, thumbnail_content_hash, thumbnail_generated_at FROM product_media ORDER BY product_code`),
      ).toEqual([
        { product_code: 800, thumbnail_storage_key: null, thumbnail_content_type: null, thumbnail_byte_length: null, thumbnail_content_hash: null, thumbnail_generated_at: null },
        { product_code: 801, thumbnail_storage_key: null, thumbnail_content_type: null, thumbnail_byte_length: null, thumbnail_content_hash: null, thumbnail_generated_at: null },
      ]);
    });
  });
});
