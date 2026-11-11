CREATE TABLE "erp_sales_history_customer_product" (
	"customer_code" integer NOT NULL,
	"product_code" integer NOT NULL,
	"top_code" integer NOT NULL,
	"top_kind" text NOT NULL,
	"note_count" integer NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"net_amount" numeric(14, 2) NOT NULL,
	"last_sale_date" date NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "erp_sales_history_customer_product_pk" PRIMARY KEY("customer_code","product_code","top_code"),
	CONSTRAINT "erp_sales_history_customer_product_values_chk" CHECK ("erp_sales_history_customer_product"."top_kind" in ('sale', 'return') and "erp_sales_history_customer_product"."note_count" >= 0 and "erp_sales_history_customer_product"."quantity" >= 0 and "erp_sales_history_customer_product"."net_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "erp_sales_history_monthly" (
	"customer_code" integer NOT NULL,
	"seller_code" integer NOT NULL,
	"month" date NOT NULL,
	"top_code" integer NOT NULL,
	"top_kind" text NOT NULL,
	"note_count" integer NOT NULL,
	"total_amount" numeric(14, 2) NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "erp_sales_history_monthly_pk" PRIMARY KEY("customer_code","seller_code","month","top_code"),
	CONSTRAINT "erp_sales_history_monthly_values_chk" CHECK ("erp_sales_history_monthly"."top_kind" in ('sale', 'return') and "erp_sales_history_monthly"."note_count" >= 0 and "erp_sales_history_monthly"."total_amount" >= 0 and extract(day from "erp_sales_history_monthly"."month") = 1)
);
--> statement-breakpoint
CREATE INDEX "erp_sales_history_monthly_seller_month_idx" ON "erp_sales_history_monthly" USING btree ("seller_code","month");--> statement-breakpoint
CREATE INDEX "erp_sales_history_monthly_month_idx" ON "erp_sales_history_monthly" USING btree ("month");