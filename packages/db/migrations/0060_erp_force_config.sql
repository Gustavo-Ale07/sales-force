CREATE TABLE "erp_force_config" (
	"id" integer PRIMARY KEY NOT NULL,
	"days_without_sync" integer,
	"default_price_table_code" integer,
	"content_hash" text NOT NULL,
	"source_changed_at" timestamp with time zone,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "erp_force_discount_limit" (
	"config_id" integer NOT NULL,
	"seq" integer NOT NULL,
	"seller_code" integer NOT NULL,
	"group_code" integer,
	"product_code" integer,
	"percent" numeric(7, 4) NOT NULL,
	"content_hash" text NOT NULL,
	"source_changed_at" timestamp with time zone,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "erp_force_discount_limit_pk" PRIMARY KEY("config_id","seq"),
	CONSTRAINT "erp_force_discount_limit_target_chk" CHECK ("erp_force_discount_limit"."product_code" is not null or "erp_force_discount_limit"."group_code" is not null),
	CONSTRAINT "erp_force_discount_limit_percent_chk" CHECK ("erp_force_discount_limit"."percent" >= 0 and "erp_force_discount_limit"."percent" <= 100)
);
--> statement-breakpoint
CREATE INDEX "erp_force_discount_limit_seller_idx" ON "erp_force_discount_limit" USING btree ("seller_code") WHERE "erp_force_discount_limit"."deleted_at" is null;
