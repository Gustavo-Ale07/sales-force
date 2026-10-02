-- Expand-only (P-16): the new role set is a strict superset of the old one, so every existing row stays valid
-- and the previous application version keeps working. The constraint is swapped inside the migration
-- transaction (no window without it).
-- Locking, stated precisely: DROP CONSTRAINT takes ACCESS EXCLUSIVE on "account" and holds it until the migration
-- transaction commits, so concurrent reads and writes of "account" wait for the whole migration. ADD ... NOT VALID
-- is cheap, and VALIDATE CONSTRAINT only shortens the validating scan to SHARE UPDATE EXCLUSIVE (it does not
-- release the earlier lock). Acceptable here: one short statement set on a small table, run by the one-shot
-- migrate step before the new version is active.
ALTER TABLE "account" DROP CONSTRAINT "account_role_chk";--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_role_chk" CHECK ("account"."role" in ('admin', 'manager', 'seller', 'technical')) NOT VALID;--> statement-breakpoint
ALTER TABLE "account" VALIDATE CONSTRAINT "account_role_chk";--> statement-breakpoint
-- `technical` is a platform-operation profile with no commercial scope: it must never carry a seller link.
-- Enforced here for `technical` only (the `admin` rule is application-level and is left as it was).
-- Both triggers (this one and account_technical_no_seller_link below) read the other table without locking it, so
-- under READ COMMITTED two concurrent transactions (one linking, one switching the role) could each pass its check
-- and both commit: they are a guard against mistakes, not race-proof. Accepted because an admin is the only writer
-- of either table; a hard guarantee would need row locks (SELECT ... FOR SHARE) or a serializable transaction.
CREATE FUNCTION "account_seller_link_no_technical"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "account" WHERE "id" = NEW."account_id" AND "role" = 'technical') THEN
    RAISE EXCEPTION 'account % has the technical role and cannot carry a seller link', NEW."account_id"
      USING ERRCODE = 'check_violation', CONSTRAINT = 'account_seller_link_no_technical';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "account_seller_link_no_technical_trg" BEFORE INSERT OR UPDATE OF "account_id" ON "account_seller_link" FOR EACH ROW EXECUTE FUNCTION "account_seller_link_no_technical"();--> statement-breakpoint
-- The other direction: an account that already has a seller link cannot be switched to `technical`.
CREATE FUNCTION "account_technical_no_seller_link"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."role" = 'technical' AND EXISTS (SELECT 1 FROM "account_seller_link" WHERE "account_id" = NEW."id") THEN
    RAISE EXCEPTION 'account % carries a seller link and cannot take the technical role', NEW."id"
      USING ERRCODE = 'check_violation', CONSTRAINT = 'account_technical_no_seller_link';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "account_technical_no_seller_link_trg" BEFORE INSERT OR UPDATE OF "role" ON "account" FOR EACH ROW EXECUTE FUNCTION "account_technical_no_seller_link"();
