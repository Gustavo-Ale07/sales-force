CREATE TABLE "sync_refresh" (
	"id" uuid PRIMARY KEY NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "sync_refresh_status_chk" CHECK ("sync_refresh"."status" in ('pending', 'running', 'done'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sync_refresh_active_uq" ON "sync_refresh" USING btree ((1)) WHERE "sync_refresh"."status" in ('pending', 'running');--> statement-breakpoint
CREATE INDEX "sync_refresh_requested_idx" ON "sync_refresh" USING btree ("requested_at");