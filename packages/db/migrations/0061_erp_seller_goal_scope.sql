ALTER TABLE "erp_seller_goal" ADD COLUMN "goal_scope" text DEFAULT 'products' NOT NULL;
--> statement-breakpoint
ALTER TABLE "erp_seller_goal" ADD CONSTRAINT "erp_seller_goal_scope_chk" CHECK ("erp_seller_goal"."goal_scope" in ('general', 'products'));
--> statement-breakpoint
ALTER TABLE "erp_seller_goal" DROP CONSTRAINT "erp_seller_goal_pk";
--> statement-breakpoint
ALTER TABLE "erp_seller_goal" ADD CONSTRAINT "erp_seller_goal_pk" PRIMARY KEY("seller_code","month","goal_scope");
