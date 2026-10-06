-- Expand-only (P-16): one nullable column and a partial unique index; every existing row stays valid and the
-- previous application version keeps working (it never reads the column). No data is changed or deleted: the
-- local admin account and the mirrored sellers are untouched. ADD COLUMN without a default is metadata-only;
-- the index is built over an empty (all-NULL, excluded) set, so it is immediate.
-- Rollback (manual, only after the application no longer writes the column; never run on a table that holds
-- linked external accounts without reviewing them first, it would sever their login link):
--   DROP INDEX "account_external_user_id_uq";
--   ALTER TABLE "account" DROP COLUMN "external_user_id";
ALTER TABLE "account" ADD COLUMN "external_user_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "account_external_user_id_uq" ON "account" USING btree ("external_user_id") WHERE "account"."external_user_id" is not null;