CREATE TABLE "erp_product_group" (
	"code" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"parent_code" integer,
	"degree" integer NOT NULL,
	"analytic" boolean NOT NULL,
	"active" boolean NOT NULL,
	"content_hash" text NOT NULL,
	"source_changed_at" timestamp with time zone,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "erp_product_group_parent_idx" ON "erp_product_group" USING btree ("parent_code") WHERE "erp_product_group"."deleted_at" is null;