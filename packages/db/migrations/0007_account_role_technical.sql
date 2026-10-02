-- Expand-only (P-16): the new role set is a strict superset of the old one, so every existing row stays valid
-- and the previous application version keeps working. The constraint is swapped inside the migration
-- transaction (no window without it); NOT VALID + VALIDATE keeps the scan under a weak lock.
ALTER TABLE "account" DROP CONSTRAINT "account_role_chk";--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_role_chk" CHECK ("account"."role" in ('admin', 'manager', 'seller', 'technical')) NOT VALID;--> statement-breakpoint
ALTER TABLE "account" VALIDATE CONSTRAINT "account_role_chk";--> statement-breakpoint
-- `technical` is a platform-operation profile with no commercial scope: it must never carry a seller link.
-- Enforced here for `technical` only (the `admin` rule is application-level and is left as it was).
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
