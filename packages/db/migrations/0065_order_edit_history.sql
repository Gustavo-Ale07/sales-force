CREATE TABLE "sales_order_erp_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"erp_number" bigint NOT NULL,
	"edited_by_account_id" uuid,
	"replaced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sales_order_erp_history_number_chk" CHECK ("sales_order_erp_history"."erp_number" > 0 and "sales_order_erp_history"."erp_number" <= 2147483647)
);
--> statement-breakpoint
ALTER TABLE "sales_order_erp_history" ADD CONSTRAINT "sales_order_erp_history_order_id_sales_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_erp_history" ADD CONSTRAINT "sales_order_erp_history_edited_by_account_id_account_id_fk" FOREIGN KEY ("edited_by_account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_order_erp_history_order_number_uq" ON "sales_order_erp_history" USING btree ("order_id","erp_number");--> statement-breakpoint
CREATE INDEX "sales_order_erp_history_order_idx" ON "sales_order_erp_history" USING btree ("order_id","replaced_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "sales_order_erp_number_immutable"() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  -- Write-once (0016), except for an order whose Sankhya note was replaced by an edit: the number being released must have a
  -- history row (sales_order_erp_history) for this very order, written in the same transaction (0065, owner ruling 2026-11-27).
  IF OLD.erp_number IS NOT NULL AND NEW.erp_number IS DISTINCT FROM OLD.erp_number THEN
    IF EXISTS (SELECT 1 FROM sales_order_erp_history h WHERE h.order_id = OLD.id AND h.erp_number = OLD.erp_number) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'sales_order: erp_number is write-once (order %)', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'sales_order_erp_number_immutable';
  END IF;
  RETURN NEW;
END
$fn$;
