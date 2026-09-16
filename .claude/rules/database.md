---
paths:
  - "packages/db/**"
---

# Database rules (PostgreSQL, packages/db)

> **Status (2026-09-16):** design mode — nothing here authorizes application code before the project owner writes `BEGIN IMPLEMENTATION`. Items citing APPROVED decisions bind now; items citing PROPOSED decisions (`STACK-1…6`, `DATA-2`, `DATA-3`, `AUTH-x`, `SYNC-x`, `MOB-1/2`, `SNK-1/2`, `OPS-3…5`, `P-23` — see `docs/decisions.md` §0) describe the working proposal and bind only once approved.

Decisions: DATA-1, DATA-2, DATA-3, SYNC-2, SYNC-3, STACK-6, P-16. Protocol: `docs/sync-protocol.md` §3–§4.

## Migrations

- Generate with Drizzle, **read the generated SQL**, commit it. Never `drizzle-kit push` outside a disposable local database. Claude Code settings deny `drizzle-kit push` entirely as a safety net; if a disposable local push is needed, the owner runs it.
- This file covers server PostgreSQL only. The mobile SQLite schema follows `.claude/rules/mobile.md`.
- Hand-written SQL (triggers, functions, views) goes in its own migration.
- Expand → migrate → contract. A migration must keep the previous application version working. The contract step waits until no active device depends on the old shape.
- Migrations run in the one-shot, lock-protected migration job, never at application startup.
- Data migrations are separate from schema migrations.
- **Stop and ask the owner** before any DROP, TRUNCATE, irreversible column removal, bulk delete, data reset or migration that can lose data. Explain the risk.

## Schema organization

- Schema files grouped per owning module. One owning module per table.
- Cross-module reporting reads use read-only SQL views.

## Conventions (DATA-3)

- Entity ids: UUIDv7 (client- or server-generated). Never rely on id order for business logic.
- Mirror rows: deterministic UUIDv5 from the Sankhya natural key + unique constraint on the natural key + `sankhya_*` source key + `sankhya_synced_at` + content hash.
- Synchronizable tables:
  - `created_at`, `updated_at`, `created_by`, `updated_by`, `deleted_at`;
  - an `xid8` column stamped by trigger with `pg_current_xact_id()` on insert/update;
  - tombstone row written in the same transaction when a mirrored row is physically removed;
  - non-null `account_id` when account-scoped.
- Money: unit prices `numeric(18,6)`; monetary totals `numeric(14,2)`. Percentages and quantities: precision NEEDS VALIDATION (spike S2) — flag the column in the PR.
- Time: `timestamptz` for events; `date` for business dates; business calculations in `America/Sao_Paulo`.
- Text search: `pg_trgm` where search is required.

## Writes

- Mirror upserts update only when the content hash differs (no-op updates re-stamp rows and inflate sync).
- No long-running transactions on synchronizable tables; batch updates commit in chunks.
- Scope events are written in the same transaction as the change that alters visibility.

## Indexes and performance

- Every index names the query it serves. Cover scope filters and sync windows.
- Measure with `EXPLAIN (ANALYZE)` on representative volumes before complex optimization.

## Testing

- PostgreSQL via Testcontainers (same major as production, DATA-1). Never shared, staging or production databases.
- Every synchronizable table participates in the concurrent-transaction watermark test (V-07).
