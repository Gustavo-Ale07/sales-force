CREATE TABLE "device_setting" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"offline_max_days" integer DEFAULT 7 NOT NULL,
	"max_active_devices" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "device_setting_singleton_chk" CHECK ("device_setting"."id" = 1),
	CONSTRAINT "device_setting_offline_max_days_chk" CHECK ("device_setting"."offline_max_days" between 1 and 60),
	CONSTRAINT "device_setting_max_active_devices_chk" CHECK ("device_setting"."max_active_devices" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "device_setting" ADD CONSTRAINT "device_setting_updated_by_account_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "device_setting" ("id") VALUES (1);
