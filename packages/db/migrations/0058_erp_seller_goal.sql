CREATE TABLE "erp_seller_goal" (
	"seller_code" integer NOT NULL,
	"month" date NOT NULL,
	"revenue_target" numeric(14, 2) NOT NULL,
	"quantity_target" numeric(18, 6) NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "erp_seller_goal_pk" PRIMARY KEY("seller_code","month"),
	CONSTRAINT "erp_seller_goal_values_chk" CHECK ("erp_seller_goal"."revenue_target" >= 0 and "erp_seller_goal"."quantity_target" >= 0 and extract(day from "erp_seller_goal"."month") = 1)
);
--> statement-breakpoint
CREATE INDEX "erp_seller_goal_month_idx" ON "erp_seller_goal" USING btree ("month");
