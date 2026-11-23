-- Order status following Sankhya (expand-only: one new table, no change to existing ones). Written by the worker only; grants in deploy/staging/db-roles.sql.
CREATE TABLE "sales_order_erp_stage" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"nunota" bigint NOT NULL,
	"stage" text NOT NULL,
	"label" text NOT NULL,
	"pending_sector" text,
	"invoice_number" bigint,
	"content_hash" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"last_error_class" text,
	"last_error_code" text,
	"last_error_at" timestamp with time zone,
	CONSTRAINT "sales_order_erp_stage_stage_chk" CHECK ("sales_order_erp_stage"."stage" in ('received', 'in_review', 'financial_check', 'in_dispatch', 'in_invoicing', 'invoiced', 'quotation')),
	CONSTRAINT "sales_order_erp_stage_error_chk" CHECK (("sales_order_erp_stage"."last_error_code" is null) = ("sales_order_erp_stage"."last_error_at" is null))
);
--> statement-breakpoint
ALTER TABLE "sales_order_erp_stage" ADD CONSTRAINT "sales_order_erp_stage_order_id_sales_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_order_erp_stage_due_idx" ON "sales_order_erp_stage" USING btree ("stage","checked_at");