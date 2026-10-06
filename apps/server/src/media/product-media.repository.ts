import { productMedia, type Database } from '@salesforce/db';
import { createHash } from 'node:crypto';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { ImageContentType } from '../catalog/product-image.js';

/**
 * Persistence of the product photo metadata (`product_media`, module media). The worker writes it; the
 * API reads it (`StoredProductImageSource`). Bytes are never here (P-17): only the object-store key.
 */
export type ProductMediaRow = typeof productMedia.$inferSelect;

/** Stable, secret-free failure code, 1..64 characters (the column check). */
export type MediaFailureReason = string;

export async function loadMediaRows(db: Database, codes: readonly number[]): Promise<Map<number, ProductMediaRow>> {
  if (codes.length === 0) return new Map();
  const rows = await db.select().from(productMedia).where(inArray(productMedia.productCode, [...codes]));
  return new Map(rows.map((row) => [row.productCode, row]));
}

/** The generated rendition of a stored original (all fields together, never partial). */
export interface ThumbnailRecord {
  readonly storageKey: string;
  readonly contentType: 'image/webp';
  readonly byteLength: number;
  readonly contentHash: string;
  readonly generatedAt: Date;
}

export function thumbnailOf(row: ProductMediaRow): ThumbnailRecord | null {
  if (row.thumbnailStorageKey === null || row.thumbnailByteLength === null || row.thumbnailContentHash === null || row.thumbnailGeneratedAt === null) return null;
  return {
    storageKey: row.thumbnailStorageKey,
    contentType: 'image/webp',
    byteLength: row.thumbnailByteLength,
    contentHash: row.thumbnailContentHash,
    generatedAt: row.thumbnailGeneratedAt,
  };
}

/**
 * Version of what the clients cache: the original hash while no thumbnail exists, and a hash of both renditions
 * afterwards, so it changes when EITHER the original or its thumbnail changes (a re-rendered thumbnail of the same
 * original, for example after a quality change, never leaves a client with a stale copy).
 */
export function mediaVersion(contentHash: string, thumbnailHash: string | null): string {
  return thumbnailHash === null ? contentHash : createHash('sha256').update(`${contentHash}|${thumbnailHash}`).digest('hex');
}

export interface StoredMediaInput {
  readonly productCode: number;
  readonly contentType: ImageContentType;
  readonly byteLength: number;
  readonly contentHash: string;
  readonly storageKey: string;
  readonly sourceLength: number;
  readonly sourceFingerprint: string;
  readonly at: Date;
  /** The thumbnail rendered from THESE bytes; absent = none (yet). */
  readonly thumbnail?: ThumbnailRecord | null;
}

/** A validated object is stored: the row becomes `stored`, clears any failure and records the signature it came from. */
export async function upsertStored(db: Database, input: StoredMediaInput): Promise<void> {
  const values = {
    status: 'stored',
    contentType: input.contentType,
    byteLength: input.byteLength,
    contentHash: input.contentHash,
    storageKey: input.storageKey,
    sourceLength: input.sourceLength,
    sourceFingerprint: input.sourceFingerprint,
    syncedAt: input.at,
    lastAttemptAt: input.at,
    failureReason: null,
    failureCount: 0,
    thumbnailStorageKey: input.thumbnail?.storageKey ?? null,
    thumbnailContentType: input.thumbnail?.contentType ?? null,
    thumbnailByteLength: input.thumbnail?.byteLength ?? null,
    thumbnailContentHash: input.thumbnail?.contentHash ?? null,
    thumbnailGeneratedAt: input.thumbnail?.generatedAt ?? null,
    updatedAt: input.at,
  };
  await db
    .insert(productMedia)
    .values({ productCode: input.productCode, ...values })
    .onConflictDoUpdate({ target: productMedia.productCode, set: values });
}

export interface FailureInput {
  readonly productCode: number;
  readonly reason: MediaFailureReason;
  /** Signature of the attempt: drives "do not retry a permanent failure until the source changes". */
  readonly sourceLength: number | null;
  readonly sourceFingerprint: string | null;
  readonly at: Date;
  /** Explicit failure count (consecutive-run counting); absent = previous count + 1. */
  readonly failureCount?: number;
}

/**
 * Records a failed attempt. A previously stored object stays described by the row (content hash,
 * storage key, type), so the old photo keeps being served; only status, reason, count and the attempted
 * signature change.
 */
export async function recordFailure(db: Database, input: FailureInput): Promise<void> {
  await db
    .insert(productMedia)
    .values({
      productCode: input.productCode,
      status: 'failed',
      sourceLength: input.sourceLength,
      sourceFingerprint: input.sourceFingerprint,
      lastAttemptAt: input.at,
      failureReason: input.reason,
      failureCount: input.failureCount ?? 1,
      updatedAt: input.at,
    })
    .onConflictDoUpdate({
      target: productMedia.productCode,
      set: {
        status: 'failed',
        sourceLength: input.sourceLength,
        sourceFingerprint: input.sourceFingerprint,
        lastAttemptAt: input.at,
        failureReason: input.reason,
        failureCount: input.failureCount ?? sql`${productMedia.failureCount} + 1`,
        // The schema allows a thumbnail only on a 'stored' row: a failed refresh drops its record (the objects stay, harmless).
        thumbnailStorageKey: null,
        thumbnailContentType: null,
        thumbnailByteLength: null,
        thumbnailContentHash: null,
        thumbnailGeneratedAt: null,
        updatedAt: input.at,
      },
    });
}

/** Attaches a (re)generated thumbnail to a STORED row and clears a previous thumbnail failure. */
export async function setThumbnail(db: Database, productCode: number, thumbnail: ThumbnailRecord, at: Date): Promise<void> {
  await db
    .update(productMedia)
    .set({
      thumbnailStorageKey: thumbnail.storageKey,
      thumbnailContentType: thumbnail.contentType,
      thumbnailByteLength: thumbnail.byteLength,
      thumbnailContentHash: thumbnail.contentHash,
      thumbnailGeneratedAt: thumbnail.generatedAt,
      failureReason: null,
      failureCount: 0,
      lastAttemptAt: at,
      updatedAt: at,
    })
    .where(and(eq(productMedia.productCode, productCode), eq(productMedia.status, 'stored')));
}

/**
 * The original is stored but its thumbnail could not be rendered: the row stays 'stored' (the original is still served),
 * any thumbnail record is dropped (it would describe a replaced or missing object) and the next run retries.
 */
export async function markThumbnailFailed(db: Database, productCode: number, reason: string, at: Date): Promise<void> {
  await db
    .update(productMedia)
    .set({
      failureReason: reason,
      failureCount: sql`${productMedia.failureCount} + 1`,
      thumbnailStorageKey: null,
      thumbnailContentType: null,
      thumbnailByteLength: null,
      thumbnailContentHash: null,
      thumbnailGeneratedAt: null,
      lastAttemptAt: at,
      updatedAt: at,
    })
    .where(and(eq(productMedia.productCode, productCode), eq(productMedia.status, 'stored')));
}

/** Unchanged product whose object was confirmed (or re-stored): only the attempt time moves. */
export async function touchAttempt(db: Database, productCode: number, at: Date): Promise<void> {
  await db.update(productMedia).set({ lastAttemptAt: at }).where(eq(productMedia.productCode, productCode));
}

export async function deleteRow(db: Database, productCode: number): Promise<void> {
  await db.delete(productMedia).where(eq(productMedia.productCode, productCode));
}

export async function listAllKeys(db: Database): Promise<{ productCode: number; storageKey: string | null; thumbnailStorageKey: string | null }[]> {
  return db
    .select({ productCode: productMedia.productCode, storageKey: productMedia.storageKey, thumbnailStorageKey: productMedia.thumbnailStorageKey })
    .from(productMedia);
}

export async function countServable(db: Database): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(productMedia)
    .where(isNotNull(productMedia.storageKey));
  return row?.n ?? 0;
}

/** Cache version by product code (see `mediaVersion`), for the products that have a servable object (stored, or failed with a previous object). */
export async function loadVersions(db: Database, codes: readonly number[]): Promise<Map<number, string>> {
  if (codes.length === 0) return new Map();
  const rows = await db
    .select({ productCode: productMedia.productCode, contentHash: productMedia.contentHash, thumbnailContentHash: productMedia.thumbnailContentHash })
    .from(productMedia)
    .where(and(inArray(productMedia.productCode, [...codes]), isNotNull(productMedia.contentHash), isNotNull(productMedia.storageKey)));
  const out = new Map<number, string>();
  for (const row of rows) if (row.contentHash !== null) out.set(row.productCode, mediaVersion(row.contentHash, row.thumbnailContentHash));
  return out;
}

export interface ServableMedia {
  readonly storageKey: string;
  readonly contentHash: string;
  readonly byteLength: number;
  readonly thumbnail: ThumbnailRecord | null;
}

export async function loadServable(db: Database, productCode: number): Promise<ServableMedia | null> {
  const [row] = await db
    .select()
    .from(productMedia)
    .where(eq(productMedia.productCode, productCode));
  if (row === undefined || row.storageKey === null || row.contentHash === null || row.byteLength === null) return null;
  return { storageKey: row.storageKey, contentHash: row.contentHash, byteLength: row.byteLength, thumbnail: thumbnailOf(row) };
}
