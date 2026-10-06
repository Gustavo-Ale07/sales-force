// Module: media — metadata of product photos whose bytes live in object storage (P-17: blobs in object
// storage, metadata in PostgreSQL; there is NO bytea column anywhere).
//
// Not a mirror table and not a synchronizable table: no soft delete, no xid8 stamping, no scope events. Photos are
// served by the API over HTTP and never travel in the offline sync stream (nothing in the schema stamps or
// tracks changes for erp_product either). Written only by the worker photo job; read by the API.
//
// No FK to erp_product: mirror tables carry no FKs (a sync may deliver rows in any order) and the mirror writer
// soft-deletes by flag, so an FK would add nothing and could only block a future physical purge. A product that
// is absent from the mirror simply never joins.
import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const PRODUCT_MEDIA_STATUSES = ['stored', 'failed'] as const;
export const PRODUCT_MEDIA_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export const PRODUCT_MEDIA_THUMBNAIL_CONTENT_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const;

export const productMedia = pgTable(
  'product_media',
  {
    /** Natural key of erp_product.code. The PK serves the batched lookup `WHERE product_code = ANY($1)`. */
    productCode: integer('product_code').primaryKey(),
    /** 'stored' = a validated object exists; 'failed' = the last attempt failed (a previous object may still be served). */
    status: text('status').notNull(),
    contentType: text('content_type'),
    byteLength: integer('byte_length'),
    /** sha256 hex (64 lowercase chars) of the stored bytes. */
    contentHash: text('content_hash'),
    /** Opaque key inside the object store, e.g. product-images/<code>/<sha256>. */
    storageKey: text('storage_key'),
    /** Source-reported length at fetch time (cheap change detection). */
    sourceLength: integer('source_length'),
    /** Opaque hash of sampled source bytes (cheap change detection). */
    sourceFingerprint: text('source_fingerprint'),
    /** Last successful store. */
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    /** Short stable code only; never a payload or binary. */
    failureReason: text('failure_reason'),
    failureCount: integer('failure_count').notNull().default(0),
    /** Generated thumbnail (worker, sharp). Key/type/length/hash are all NULL (none yet) or all NOT NULL. */
    thumbnailStorageKey: text('thumbnail_storage_key'),
    thumbnailContentType: text('thumbnail_content_type'),
    thumbnailByteLength: integer('thumbnail_byte_length'),
    /** sha256 hex (64 lowercase chars) of the thumbnail bytes. */
    thumbnailContentHash: text('thumbnail_content_hash'),
    thumbnailGeneratedAt: timestamp('thumbnail_generated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('product_media_status_chk', sql`${t.status} in ('stored', 'failed')`),
    check(
      'product_media_content_type_chk',
      sql`${t.contentType} is null or ${t.contentType} in ('image/png', 'image/jpeg', 'image/webp')`,
    ),
    check('product_media_content_hash_chk', sql`${t.contentHash} is null or ${t.contentHash} ~ '^[0-9a-f]{64}$'`),
    check('product_media_byte_length_chk', sql`${t.byteLength} is null or ${t.byteLength} > 0`),
    check('product_media_source_length_chk', sql`${t.sourceLength} is null or ${t.sourceLength} >= 0`),
    check('product_media_failure_count_chk', sql`${t.failureCount} >= 0`),
    check(
      'product_media_failure_reason_chk',
      sql`${t.failureReason} is null or char_length(${t.failureReason}) between 1 and 64`,
    ),
    check(
      'product_media_stored_chk',
      sql`${t.status} <> 'stored' or (${t.contentType} is not null and ${t.byteLength} is not null and ${t.contentHash} is not null and ${t.storageKey} is not null and ${t.sourceLength} is not null and ${t.sourceFingerprint} is not null and ${t.syncedAt} is not null)`,
    ),
    check(
      'product_media_thumbnail_chk',
      sql`(${t.thumbnailStorageKey} is null and ${t.thumbnailContentType} is null and ${t.thumbnailByteLength} is null and ${t.thumbnailContentHash} is null) or (${t.status} = 'stored' and ${t.thumbnailStorageKey} is not null and char_length(${t.thumbnailStorageKey}) between 1 and 512 and ${t.thumbnailContentType} is not null and ${t.thumbnailContentType} in ('image/webp', 'image/jpeg', 'image/png') and ${t.thumbnailByteLength} is not null and ${t.thumbnailByteLength} > 0 and ${t.thumbnailContentHash} is not null and ${t.thumbnailContentHash} ~ '^[0-9a-f]{64}$')`,
    ),
  ],
);
