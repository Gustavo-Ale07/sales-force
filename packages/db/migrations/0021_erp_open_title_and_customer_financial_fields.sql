CREATE TABLE "erp_open_title" (
	"nufin" integer PRIMARY KEY NOT NULL,
	"customer_code" integer NOT NULL,
	"company_code" integer,
	"document_number" integer,
	"due_date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"paid_amount" numeric(14, 2) NOT NULL,
	"content_hash" text NOT NULL,
	"source_changed_at" timestamp with time zone,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "erp_open_title_amounts_chk" CHECK ("erp_open_title"."amount" >= 0 and "erp_open_title"."paid_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "erp_customer" ADD COLUMN "monthly_credit_limit" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "erp_customer" ADD COLUMN "block_reason" text;--> statement-breakpoint
ALTER TABLE "erp_customer" ADD COLUMN "situation" text;--> statement-breakpoint
CREATE INDEX "erp_open_title_customer_due_idx" ON "erp_open_title" USING btree ("customer_code","due_date") WHERE "erp_open_title"."deleted_at" is null;