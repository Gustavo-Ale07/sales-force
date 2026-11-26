CREATE TABLE "erp_city" (
	"code" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"uf" text NOT NULL,
	"ibge" text,
	"content_hash" text NOT NULL,
	"source_changed_at" timestamp with time zone,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "erp_neighborhood" (
	"code" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"content_hash" text NOT NULL,
	"source_changed_at" timestamp with time zone,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "erp_street" (
	"code" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text,
	"content_hash" text NOT NULL,
	"source_changed_at" timestamp with time zone,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "erp_city_name_idx" ON "erp_city" USING btree ("name") WHERE "erp_city"."deleted_at" is null;