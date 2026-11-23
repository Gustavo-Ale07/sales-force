CREATE TABLE "sales_order_release_pending" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"nunota" bigint NOT NULL,
	"event" integer NOT NULL,
	"cascade_sequence" integer,
	"sector" text NOT NULL,
	"assigned_user_code" integer,
	"requested_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"notified_at" timestamp with time zone,
	CONSTRAINT "sales_order_release_pending_line_uq" UNIQUE NULLS NOT DISTINCT("order_id","event","sector","cascade_sequence")
);
--> statement-breakpoint
ALTER TABLE "sales_order_release_pending" ADD CONSTRAINT "sales_order_release_pending_order_id_sales_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_order_release_pending_sector_idx" ON "sales_order_release_pending" USING btree ("sector","first_seen_at");--> statement-breakpoint
CREATE INDEX "sales_order_release_pending_assignee_idx" ON "sales_order_release_pending" USING btree ("assigned_user_code");