-- Expand-only (P-16): one new table, nothing existing is touched; the previous application version never
-- references it. CREATE TABLE on an empty new table takes no lock on existing tables.
-- Metadata only (P-17): the photo bytes live in object storage, referenced by storage_key; no bytea.
-- Deliberately NOT a synchronizable table: no soft delete, no xid8 stamping, no scope events. Photos are served by
-- the API over HTTP, not through the offline sync stream (erp_product itself carries no change stamping).
-- Deliberately no FK to erp_product: mirror tables have none (rows may arrive in any order) and the mirror writer
-- only soft-deletes, so an FK adds nothing and could only block a future physical purge.
-- No extra index: the primary key serves `WHERE product_code = ANY($1)`; failed rows for retry are a small set.
-- Grants (deploy/staging/db-roles.sql): force_api SELECT, force_worker SELECT, INSERT, UPDATE, DELETE.
-- Rollback (manual, only after the application no longer uses it; stored objects stay in the bucket):
--   DROP TABLE "product_media";
CREATE TABLE "product_media" (
	"product_code" integer PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"content_type" text,
	"byte_length" integer,
	"content_hash" text,
	"storage_key" text,
	"source_length" integer,
	"source_fingerprint" text,
	"synced_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"failure_reason" text,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_media_status_chk" CHECK ("product_media"."status" in ('stored', 'failed')),
	CONSTRAINT "product_media_content_type_chk" CHECK ("product_media"."content_type" is null or "product_media"."content_type" in ('image/png', 'image/jpeg', 'image/webp')),
	CONSTRAINT "product_media_content_hash_chk" CHECK ("product_media"."content_hash" is null or "product_media"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "product_media_byte_length_chk" CHECK ("product_media"."byte_length" is null or "product_media"."byte_length" > 0),
	CONSTRAINT "product_media_source_length_chk" CHECK ("product_media"."source_length" is null or "product_media"."source_length" >= 0),
	CONSTRAINT "product_media_failure_count_chk" CHECK ("product_media"."failure_count" >= 0),
	CONSTRAINT "product_media_failure_reason_chk" CHECK ("product_media"."failure_reason" is null or char_length("product_media"."failure_reason") between 1 and 64),
	CONSTRAINT "product_media_stored_chk" CHECK ("product_media"."status" <> 'stored' or ("product_media"."content_type" is not null and "product_media"."byte_length" is not null and "product_media"."content_hash" is not null and "product_media"."storage_key" is not null and "product_media"."source_length" is not null and "product_media"."source_fingerprint" is not null and "product_media"."synced_at" is not null))
);
