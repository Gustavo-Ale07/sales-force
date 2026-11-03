CREATE TABLE "erp_ipi_rate" (
	"code" integer PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"percentual" numeric(9, 4) NOT NULL,
	"by_tariff" boolean NOT NULL,
	"content_hash" text NOT NULL,
	"source_changed_at" timestamp with time zone,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "erp_product" ADD COLUMN "ipi_code" integer;