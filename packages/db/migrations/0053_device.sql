CREATE TABLE "device" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"install_id" text NOT NULL,
	"label" text NOT NULL,
	"platform" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	CONSTRAINT "device_platform_chk" CHECK ("device"."platform" in ('android', 'ios')),
	CONSTRAINT "device_status_chk" CHECK ("device"."status" in ('pending', 'approved', 'revoked')),
	CONSTRAINT "device_install_id_chk" CHECK ("device"."install_id" ~ '^[A-Za-z0-9-]{8,64}$')
);
--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_decided_by_account_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_account_install_uq" ON "device" USING btree ("account_id","install_id");--> statement-breakpoint
CREATE INDEX "device_status_created_idx" ON "device" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_device_id_idx" ON "session" USING btree ("device_id");
