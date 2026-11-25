ALTER TABLE "sales_order" ADD COLUMN "erp_removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_order" ADD COLUMN "erp_missing_checks" smallint DEFAULT 0 NOT NULL;