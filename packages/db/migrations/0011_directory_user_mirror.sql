-- Expand-only (P-16): a NEW table (no existing code reads it) plus one column with a constant DEFAULT on account_seller_link
-- (catalog-only in PostgreSQL >= 11, no rewrite) and one CHECK that every existing row satisfies ('manual'). The previous
-- application version keeps working: it never writes the column, so its links stay 'manual' (authoritative, never auto-changed).
-- erp_directory_user holds ONLY the ERP user code and its seller code (no name, e-mail, credential or permission).
-- Grants: deploy/staging/db-roles.sql (force_worker: S/I/U; force_api: S).
-- Rollback (manual, only after the application no longer uses them; no data other than the mirror is lost):
--   ALTER TABLE "account_seller_link" DROP CONSTRAINT "account_seller_link_source_chk";
--   ALTER TABLE "account_seller_link" DROP COLUMN "source";
--   DROP TABLE "erp_directory_user";
CREATE TABLE "erp_directory_user" (
	"code" integer PRIMARY KEY NOT NULL,
	"seller_code" integer,
	"content_hash" text NOT NULL,
	"source_changed_at" timestamp with time zone,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account_seller_link" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
CREATE INDEX "erp_directory_user_seller_code_idx" ON "erp_directory_user" USING btree ("seller_code") WHERE "erp_directory_user"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "account_seller_link" ADD CONSTRAINT "account_seller_link_source_chk" CHECK ("account_seller_link"."source" in ('manual', 'sankhya_auto'));