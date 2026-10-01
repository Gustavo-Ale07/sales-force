# Migration 0006 plan: `account_seller_link_seller_code_chk`

Working note (not a decision). Governed by P-16 / DATA-2 and `.claude/rules/database.md`.

**Migration:** `packages/db/migrations/0006_account_seller_link_seller_code_check.sql`

```sql
ALTER TABLE "account_seller_link" ADD CONSTRAINT "account_seller_link_seller_code_chk"
  CHECK ("account_seller_link"."seller_code" >= 1) NOT VALID;
```

Constraint name is `account_seller_link_seller_code_chk` (not `..._check`; `0006_..._check` is only the file name).

## Audit result

- Expand-only: ADD CONSTRAINT ... NOT VALID takes a brief ACCESS EXCLUSIVE lock for the catalog change only (no table scan, no rewrite). Existing rows are not checked.
- Enforced from now on: every INSERT and every UPDATE (checked against the new row version). Consequence: a legacy row with `seller_code < 1` cannot be updated at all (not even `config_version_id`) until its code is fixed. The only writer is the identity upsert (`apps/server/src/iam/account.repository.ts`, `ON CONFLICT (account_id) DO UPDATE`) and the seed; an upsert hitting a legacy row with a still-invalid code fails, which is the intended F2 behavior (a seller 0 link must never grant a scope).
- No DROP/DELETE/UPDATE in the file. Tests: `packages/db/tests/migrations.test.ts` ("0006 is expand-only"): legacy row survives, insert of 0 / -2 refused, update to 0 refused (valid row and legacy row), update of legacy row to a real code accepted.

## A) Identify invalid old rows (read-only, run per environment)

```sql
SELECT l.account_id, l.seller_code, l.config_version_id, a.email, a.status, a.role
FROM account_seller_link l
JOIN account a ON a.id = l.account_id
WHERE l.seller_code < 1
ORDER BY l.seller_code, a.email;

-- Count only:
SELECT count(*) FROM account_seller_link WHERE seller_code < 1;
```

Run on DEV, staging, pilot/production with a read-only role, in a read-only transaction (`BEGIN READ ONLY`). Record the counts per environment in the change ticket. Emails are personal data: do not paste results into docs or chat; share counts and account ids only.

## B) Reconciliation / cleanup (only for environments where A returns rows)

1. **No guessing.** The correct seller comes from the owner/backoffice or from the Sankhya-governed seller mapping (CFG-1/CFG-2, mirrored in the installation configuration), never inferred by name, email or position.
2. **Backup first:** a verified restore point (PITR marker or `pg_dump` of `account_seller_link` and `account`) taken immediately before the change; the restore path must be known to work (OPS-2).
3. **Per row, one of:**
   - `UPDATE account_seller_link SET seller_code = <confirmed code>, config_version_id = <current> WHERE account_id = <id> AND seller_code < 1;` (the code must exist in the mirrored seller data), or
   - remove the link (account then has no seller scope). A DELETE is a destructive operation: **needs explicit owner approval** with the list of account ids.
4. **Audit:** each change is recorded in the audit log (`account.seller_linked` or an admin-change entry, actor = operator, with account id and old/new code, no personal data beyond ids). Run in small chunks, short transactions.
5. **DEV:** no cleanup unless the rows block work; a disposable DEV database may simply be reseeded (owner runs it). Never `drizzle-kit push`.
6. Re-run query A; it must return 0 rows in that environment.

## C) VALIDATE CONSTRAINT as its own later migration

```sql
ALTER TABLE "account_seller_link" VALIDATE CONSTRAINT "account_seller_link_seller_code_chk";
```

Preconditions (all required):
- Migration 0006 applied in the environment, and A returns 0 rows there (B finished and audited). Validate per environment only after its cleanup; a single shared migration means it must be preceded by the cleanup in every environment, otherwise the migration fails (it rolls back; no damage, but blocks the release).
- It is a separate, tracked schema migration containing only the VALIDATE statement (no data changes mixed in; data fixes are B, run beforehand as a data step).
- Lock: `SHARE UPDATE EXCLUSIVE`, full scan, concurrent reads/writes continue. The table is small (one row per linked account); still run in the normal one-shot migration step, not at app startup.
- Add a test: legacy row fixed, then validation succeeds (`convalidated = true` in `pg_constraint`); and with a remaining invalid row it fails and rolls back.
- No rollback needed beyond restore; VALIDATE changes no data.

## D) Contraction

Nothing to contract by default: the constraint stays (it is the end state, matching the Drizzle schema in `iam.ts`). Only after C is validated everywhere may the `0` "no seller" placeholder be considered fully retired; any further removal (e.g. code paths tolerating 0) is a separate application change after released mobile clients no longer depend on it (P-16). No schema DROP is planned; any would need owner approval.

## Status

Plan only; no environment inspected, no data changed.
