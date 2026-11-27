CREATE TABLE "force_config" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"max_days_without_sync" integer DEFAULT 7 NOT NULL,
	"default_price_table_code" integer DEFAULT 5 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "force_config_singleton_chk" CHECK ("force_config"."id" = 1),
	CONSTRAINT "force_config_max_days_chk" CHECK ("force_config"."max_days_without_sync" between 1 and 60),
	CONSTRAINT "force_config_price_table_chk" CHECK ("force_config"."default_price_table_code" >= 0)
);
--> statement-breakpoint
CREATE TABLE "seller_discount_rule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seller_code" integer NOT NULL,
	"target_kind" text NOT NULL,
	"target_code" integer,
	"max_percent" numeric(7, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "seller_discount_rule_kind_chk" CHECK ("seller_discount_rule"."target_kind" in ('product', 'subgroup', 'group', 'none')),
	CONSTRAINT "seller_discount_rule_target_chk" CHECK (("seller_discount_rule"."target_kind" = 'none' and "seller_discount_rule"."target_code" is null) or ("seller_discount_rule"."target_kind" <> 'none' and "seller_discount_rule"."target_code" is not null and "seller_discount_rule"."target_code" > 0)),
	CONSTRAINT "seller_discount_rule_percent_chk" CHECK ("seller_discount_rule"."max_percent" >= 0 and "seller_discount_rule"."max_percent" <= 100),
	CONSTRAINT "seller_discount_rule_seller_chk" CHECK ("seller_discount_rule"."seller_code" > 0)
);
--> statement-breakpoint
ALTER TABLE "force_config" ADD CONSTRAINT "force_config_updated_by_account_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_discount_rule" ADD CONSTRAINT "seller_discount_rule_updated_by_account_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "seller_discount_rule_target_uidx" ON "seller_discount_rule" USING btree ("seller_code","target_kind",coalesce("target_code", 0));--> statement-breakpoint
CREATE INDEX "seller_discount_rule_seller_idx" ON "seller_discount_rule" USING btree ("seller_code");--> statement-breakpoint
-- Seed (owner ruling 2026-11-27): the single configuration row. Days start from the value already saved in device_setting (7 when none); the default price table starts at 5.
INSERT INTO "force_config" ("id", "max_days_without_sync", "default_price_table_code") SELECT 1, COALESCE((SELECT "offline_max_days" FROM "device_setting" WHERE "id" = 1), 7), 5 ON CONFLICT ("id") DO NOTHING;
