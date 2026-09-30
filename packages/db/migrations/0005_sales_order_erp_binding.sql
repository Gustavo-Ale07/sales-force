ALTER TABLE "sales_order" ADD COLUMN "dataset_origin" text DEFAULT 'legacy_dev' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_order" ADD COLUMN "erp_environment" text;--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_dataset_origin_chk" CHECK ("sales_order"."dataset_origin" in ('legacy_dev', 'fake', 'sankhya'));--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_erp_environment_chk" CHECK ("sales_order"."erp_environment" is null or ("sales_order"."erp_environment" <> '' and "sales_order"."dataset_origin" = 'sankhya'));--> statement-breakpoint
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_erp_eligibility_chk" CHECK ("sales_order"."status" not in ('queued', 'sent', 'rejected', 'unknown') or ("sales_order"."dataset_origin" = 'sankhya' and "sales_order"."erp_environment" is not null));--> statement-breakpoint
CREATE FUNCTION "sales_order_binding_immutable"() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.dataset_origin IS DISTINCT FROM OLD.dataset_origin OR NEW.erp_environment IS DISTINCT FROM OLD.erp_environment THEN
    RAISE EXCEPTION 'sales_order: dataset_origin/erp_environment are immutable once stamped (order %)', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'sales_order_binding_immutable';
  END IF;
  RETURN NEW;
END
$fn$;--> statement-breakpoint
CREATE TRIGGER "sales_order_binding_immutable_trg" BEFORE UPDATE OF "dataset_origin", "erp_environment" ON "sales_order" FOR EACH ROW EXECUTE FUNCTION "sales_order_binding_immutable"();--> statement-breakpoint
CREATE FUNCTION "integration_outbox_order_gate"() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  -- Insert, or claim/retry of an existing row: a sales_order aggregate must be a bound Sankhya order.
  IF NEW.aggregate_type = 'sales_order' AND NOT EXISTS (
    SELECT 1 FROM sales_order
     WHERE id = NEW.aggregate_id AND dataset_origin = 'sankhya' AND erp_environment IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'integration_outbox: order % is not eligible for ERP submission (legacy/fake/unbound dataset)', NEW.aggregate_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'integration_outbox_order_gate';
  END IF;
  RETURN NEW;
END
$fn$;--> statement-breakpoint
CREATE TRIGGER "integration_outbox_order_gate_trg" BEFORE INSERT OR UPDATE OF "aggregate_type", "aggregate_id", "status" ON "integration_outbox" FOR EACH ROW EXECUTE FUNCTION "integration_outbox_order_gate"();
