-- Expand-only (P-16): the new role set is a strict superset of the old one, so every existing row stays valid and the previous
-- application version keeps working (it never creates or reads an `operations` account). Same swap as migration 0007: the
-- constraint is replaced inside the migration transaction (no window without it). DROP CONSTRAINT holds ACCESS EXCLUSIVE on
-- "account" until commit (one short statement set on a small table, run by the one-shot migrate step before the new version is active).
-- Owner ruling 2026-11-23 (option A): `operations` = internal staff of Pedidos / Financeiro (release queue only; web only).
ALTER TABLE "account" DROP CONSTRAINT "account_role_chk";--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_role_chk" CHECK ("account"."role" in ('admin', 'manager', 'seller', 'technical', 'operations')) NOT VALID;--> statement-breakpoint
ALTER TABLE "account" VALIDATE CONSTRAINT "account_role_chk";--> statement-breakpoint
-- Like `technical`, `operations` has no commercial scope and must never carry a seller link (both directions, as in 0007; CREATE OR
-- REPLACE keeps the triggers and widens only the role list, so older versions are unaffected). Same READ COMMITTED caveat as 0007:
-- a guard against mistakes, not race-proof; an admin is the only writer of either table.
CREATE OR REPLACE FUNCTION "account_seller_link_no_technical"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "account" WHERE "id" = NEW."account_id" AND "role" IN ('technical', 'operations')) THEN
    RAISE EXCEPTION 'account % has a role without commercial scope (technical/operations) and cannot carry a seller link', NEW."account_id"
      USING ERRCODE = 'check_violation', CONSTRAINT = 'account_seller_link_no_technical';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "account_technical_no_seller_link"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."role" IN ('technical', 'operations') AND EXISTS (SELECT 1 FROM "account_seller_link" WHERE "account_id" = NEW."id") THEN
    RAISE EXCEPTION 'account % carries a seller link and cannot take a role without commercial scope (technical/operations)', NEW."id"
      USING ERRCODE = 'check_violation', CONSTRAINT = 'account_technical_no_seller_link';
  END IF;
  RETURN NEW;
END;
$$;
