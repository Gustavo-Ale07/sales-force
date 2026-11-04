-- D-Y (owner, 2026-11-04): there is no "discarded" order state any more; the seller deletes. Data step of the
-- expand -> migrate -> contract sequence (P-16): remove the orders already in the retired `cancelled` status.
-- The count is reported (NOTICE) so the operator can record it. Items and approval requests go with the order
-- (ON DELETE CASCADE); the delivery rows (and, through them, their dry-run records) are removed explicitly.
DO $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM "integration_outbox"
   WHERE "aggregate_type" = 'sales_order'
     AND "aggregate_id" IN (SELECT "id" FROM "sales_order" WHERE "status" = 'cancelled');
  DELETE FROM "sales_order" WHERE "status" = 'cancelled';
  GET DIAGNOSTICS removed = ROW_COUNT;
  RAISE NOTICE 'D-Y: % cancelled order(s) deleted', removed;
END
$$;
