CREATE TABLE "erp_positivation_order" (
	"customer_code" integer NOT NULL,
	"seller_code" integer NOT NULL,
	"month" date NOT NULL,
	"order_number" integer NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "erp_positivation_order_pk" PRIMARY KEY("customer_code","order_number","month"),
	CONSTRAINT "erp_positivation_order_month_chk" CHECK (extract(day from "erp_positivation_order"."month") = 1)
);
--> statement-breakpoint
CREATE INDEX "erp_positivation_order_month_idx" ON "erp_positivation_order" USING btree ("month");
