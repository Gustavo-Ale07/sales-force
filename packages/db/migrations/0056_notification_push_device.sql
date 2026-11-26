CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"push_state" text DEFAULT 'pending' NOT NULL,
	"push_attempts" integer DEFAULT 0 NOT NULL,
	"pushed_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_category_chk" CHECK ("notification"."category" in ('order', 'customer', 'task')),
	CONSTRAINT "notification_push_state_chk" CHECK ("notification"."push_state" in ('pending', 'sent', 'skipped', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "push_device" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"token" text NOT NULL,
	"platform" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "push_device_platform_chk" CHECK ("push_device"."platform" in ('android', 'ios'))
);
--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_device" ADD CONSTRAINT "push_device_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_account_dedupe_uq" ON "notification" USING btree ("account_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notification_account_created_idx" ON "notification" USING btree ("account_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notification_account_unread_idx" ON "notification" USING btree ("account_id") WHERE "notification"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notification_push_pending_idx" ON "notification" USING btree ("created_at") WHERE "notification"."push_state" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "push_device_token_uq" ON "push_device" USING btree ("token");--> statement-breakpoint
CREATE INDEX "push_device_account_idx" ON "push_device" USING btree ("account_id") WHERE "push_device"."disabled_at" is null;
