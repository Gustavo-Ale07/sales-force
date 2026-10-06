-- Expand-only (P-16): five NULLABLE columns without defaults (catalog-only change in PostgreSQL >= 11, no table
-- rewrite) plus one CHECK that existing rows satisfy (every thumbnail column is NULL), so the previous application
-- version keeps working. ADD CONSTRAINT takes a short ACCESS EXCLUSIVE lock and scans the small product_media table.
-- Thumbnail = generated WebP derivative of the stored photo (bytes in object storage, metadata only here, P-17).
-- Either key/type/length/hash are all NULL (no thumbnail yet) or all valid; a thumbnail exists only on 'stored' rows.
-- Grants: unchanged (table-level, deploy/staging/db-roles.sql).
-- Rollback (manual, only after the application no longer uses it; thumbnail objects stay in the bucket):
--   ALTER TABLE "product_media" DROP CONSTRAINT "product_media_thumbnail_chk";
--   ALTER TABLE "product_media" DROP COLUMN "thumbnail_storage_key", DROP COLUMN "thumbnail_content_type",
--     DROP COLUMN "thumbnail_byte_length", DROP COLUMN "thumbnail_content_hash", DROP COLUMN "thumbnail_generated_at";
ALTER TABLE "product_media" ADD COLUMN "thumbnail_storage_key" text;--> statement-breakpoint
ALTER TABLE "product_media" ADD COLUMN "thumbnail_content_type" text;--> statement-breakpoint
ALTER TABLE "product_media" ADD COLUMN "thumbnail_byte_length" integer;--> statement-breakpoint
ALTER TABLE "product_media" ADD COLUMN "thumbnail_content_hash" text;--> statement-breakpoint
ALTER TABLE "product_media" ADD COLUMN "thumbnail_generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_thumbnail_chk" CHECK (("product_media"."thumbnail_storage_key" is null and "product_media"."thumbnail_content_type" is null and "product_media"."thumbnail_byte_length" is null and "product_media"."thumbnail_content_hash" is null) or ("product_media"."status" = 'stored' and "product_media"."thumbnail_storage_key" is not null and char_length("product_media"."thumbnail_storage_key") between 1 and 512 and "product_media"."thumbnail_content_type" is not null and "product_media"."thumbnail_content_type" in ('image/webp', 'image/jpeg', 'image/png') and "product_media"."thumbnail_byte_length" is not null and "product_media"."thumbnail_byte_length" > 0 and "product_media"."thumbnail_content_hash" is not null and "product_media"."thumbnail_content_hash" ~ '^[0-9a-f]{64}$'));