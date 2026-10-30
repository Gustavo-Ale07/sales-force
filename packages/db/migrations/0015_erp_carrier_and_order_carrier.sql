CREATE TABLE "erp_carrier" (
	"code" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"active" boolean NOT NULL,
	"content_hash" text NOT NULL,
	"source_changed_at" timestamp with time zone,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sales_order" ADD COLUMN "carrier_code" integer;