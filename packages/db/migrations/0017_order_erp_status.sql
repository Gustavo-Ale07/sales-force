ALTER TABLE "sales_order" ADD COLUMN "erp_status_code" integer;--> statement-breakpoint
ALTER TABLE "sales_order" ADD COLUMN "erp_status_label" text;--> statement-breakpoint
ALTER TABLE "sales_order" ADD COLUMN "erp_invoice_number" bigint;--> statement-breakpoint
ALTER TABLE "sales_order" ADD COLUMN "erp_status_checked_at" timestamp with time zone;