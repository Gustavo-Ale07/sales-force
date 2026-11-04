-- D-Z (data migration, separate from 0026): rows parked by the old dry run (pending, no next attempt, step dry_run) become
-- terminal, release their origin id, and their queued order returns to draft. Nothing was ever sent for them.
WITH parked AS (
  UPDATE "integration_outbox"
     SET "status" = 'dry_run', "origin_id" = NULL, "updated_at" = now()
   WHERE "status" = 'pending' AND "next_attempt_at" IS NULL AND "last_step" = 'dry_run'
  RETURNING "aggregate_id"
), back AS (
  UPDATE "sales_order"
     SET "status" = 'draft', "version" = "version" + 1, "updated_at" = now()
   WHERE "status" = 'queued' AND "id" IN (SELECT "aggregate_id" FROM parked)
  RETURNING 1
)
SELECT count(*) FROM back;
