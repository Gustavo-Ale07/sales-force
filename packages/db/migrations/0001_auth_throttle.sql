CREATE TABLE "auth_throttle" (
	"key" text PRIMARY KEY NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"lockout_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_throttle_failures_chk" CHECK ("auth_throttle"."failures" >= 0),
	CONSTRAINT "auth_throttle_lockout_count_chk" CHECK ("auth_throttle"."lockout_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "auth_throttle_updated_at_idx" ON "auth_throttle" USING btree ("updated_at");