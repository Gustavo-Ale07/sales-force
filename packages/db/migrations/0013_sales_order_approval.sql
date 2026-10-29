CREATE TABLE "sales_order_approval" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"order_version" integer NOT NULL,
	"requested_level" text NOT NULL,
	"requested_by_account_id" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"decision" text DEFAULT 'pending' NOT NULL,
	"decided_by_account_id" uuid,
	"decided_at" timestamp with time zone,
	"comment" text,
	CONSTRAINT "sales_order_approval_level_chk" CHECK ("sales_order_approval"."requested_level" in ('manager', 'director')),
	CONSTRAINT "sales_order_approval_decision_chk" CHECK ("sales_order_approval"."decision" in ('pending', 'approved', 'rejected', 'invalidated')),
	CONSTRAINT "sales_order_approval_shape_chk" CHECK (("sales_order_approval"."decision" = 'pending' and "sales_order_approval"."decided_at" is null and "sales_order_approval"."decided_by_account_id" is null)
        or ("sales_order_approval"."decision" in ('approved', 'rejected') and "sales_order_approval"."decided_at" is not null and "sales_order_approval"."decided_by_account_id" is not null)
        or ("sales_order_approval"."decision" = 'invalidated' and "sales_order_approval"."decided_at" is not null and "sales_order_approval"."decided_by_account_id" is null)),
	CONSTRAINT "sales_order_approval_reject_comment_chk" CHECK ("sales_order_approval"."decision" <> 'rejected' or coalesce(length(btrim("sales_order_approval"."comment")), 0) > 0),
	CONSTRAINT "sales_order_approval_comment_len_chk" CHECK ("sales_order_approval"."comment" is null or length("sales_order_approval"."comment") <= 500)
);
--> statement-breakpoint
ALTER TABLE "sales_order" DROP CONSTRAINT "sales_order_status_chk";--> statement-breakpoint
ALTER TABLE "sales_order_approval" ADD CONSTRAINT "sales_order_approval_order_id_sales_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_approval" ADD CONSTRAINT "sales_order_approval_requested_by_account_id_account_id_fk" FOREIGN KEY ("requested_by_account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_approval" ADD CONSTRAINT "sales_order_approval_decided_by_account_id_account_id_fk" FOREIGN KEY ("decided_by_account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_order_approval_pending_uq" ON "sales_order_approval" USING btree ("order_id") WHERE "sales_order_approval"."decision" = 'pending';--> statement-breakpoint
CREATE INDEX "sales_order_approval_order_idx" ON "sales_order_approval" USING btree ("order_id","requested_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sales_order_approval_queue_idx" ON "sales_order_approval" USING btree ("requested_level","decision","requested_at");--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_status_chk" CHECK ("sales_order"."status" in ('draft', 'awaiting_approval', 'approved', 'approval_rejected', 'cancelled', 'queued', 'sent', 'rejected', 'unknown'));