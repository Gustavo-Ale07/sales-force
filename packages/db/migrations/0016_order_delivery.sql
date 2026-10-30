CREATE TABLE "integration_order_dry_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"outbox_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_outbox" ADD COLUMN "last_step" text;--> statement-breakpoint
ALTER TABLE "integration_order_dry_run" ADD CONSTRAINT "integration_order_dry_run_outbox_id_integration_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."integration_outbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_order_dry_run_outbox_uq" ON "integration_order_dry_run" USING btree ("outbox_id");--> statement-breakpoint
CREATE INDEX "integration_order_dry_run_created_idx" ON "integration_order_dry_run" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "integration_outbox_deliverable_idx" ON "integration_outbox" USING btree ("next_attempt_at","created_at") WHERE "integration_outbox"."status" in ('pending', 'unknown') and "integration_outbox"."next_attempt_at" is not null;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_erp_number_chk" CHECK ("sales_order"."erp_number" is null or ("sales_order"."erp_number" > 0 and "sales_order"."erp_number" <= 2147483647));--> statement-breakpoint
ALTER TABLE "integration_outbox" ADD CONSTRAINT "integration_outbox_last_step_chk" CHECK ("integration_outbox"."last_step" is null or "integration_outbox"."last_step" in ('verifying_origin', 'sending', 'linked_existing', 'waiting_retry', 'awaiting_confirmation', 'confirmed', 'dry_run'));--> statement-breakpoint
CREATE FUNCTION "sales_order_erp_number_immutable"() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.erp_number IS NOT NULL AND NEW.erp_number IS DISTINCT FROM OLD.erp_number THEN
    RAISE EXCEPTION 'sales_order: erp_number is write-once (order %)', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'sales_order_erp_number_immutable';
  END IF;
  RETURN NEW;
END
$fn$;--> statement-breakpoint
CREATE TRIGGER "sales_order_erp_number_immutable_trg" BEFORE UPDATE OF "erp_number" ON "sales_order" FOR EACH ROW EXECUTE FUNCTION "sales_order_erp_number_immutable"();
