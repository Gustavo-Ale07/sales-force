import type { Migration } from "./migrator";

/**
 * Production schema of the on-device database. Only what offline operation needs (never a copy of the server, and
 * never cost/margin: P-20). v1 is the sync/outbox foundation; reference-data caches (customers, products, pricing
 * context) and local order drafts arrive as v2+ with the offline slice, after the sync protocol sections they depend
 * on are APPROVED. Design record: `docs/mobile-spike.md` §8.
 *
 * Rules: append-only, never edit a shipped migration, expand → migrate → contract (P-16).
 */
export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "sync_metadata_and_outbox",
    statements: [
      `CREATE TABLE sync_metadata (
        key        TEXT PRIMARY KEY NOT NULL,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      // One row per offline command. `idempotency_key` is the same clientRequestId the online path already sends;
      // it is minted once at enqueue and reused verbatim on every retry (SNK-4 / P-08), so a resend after a dropped
      // connection cannot create a second order. `operation_id` identifies the command itself.
      `CREATE TABLE outbox (
        local_id        TEXT PRIMARY KEY NOT NULL,
        operation_id    TEXT NOT NULL UNIQUE,
        idempotency_key TEXT NOT NULL UNIQUE,
        type            TEXT NOT NULL,
        payload         TEXT NOT NULL,
        state           TEXT NOT NULL DEFAULT 'pending'
                        CHECK (state IN ('pending', 'sending', 'accepted', 'rejected', 'needs_review', 'conflict')),
        attempts        INTEGER NOT NULL DEFAULT 0,
        last_error      TEXT,
        base_version    INTEGER,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      ) STRICT`,
      `CREATE INDEX outbox_state_created_idx ON outbox (state, created_at)`,
    ],
  },
  {
    // Offline slice (MOB-6): reference-data cache, local order drafts and the outbox columns the sync engine needs.
    // Expand-only on top of v1 (P-16). The caches hold exactly what the API already delivers to the actor's own
    // scope, as JSON, plus normalized search columns; no cost or margin exists in any of these shapes (P-20).
    version: 2,
    name: "offline_cache_drafts_outbox_columns",
    statements: [
      `CREATE TABLE cache_customer (
        code        INTEGER PRIMARY KEY NOT NULL,
        name        TEXT NOT NULL,
        sort_text   TEXT NOT NULL,
        search_text TEXT NOT NULL,
        data        TEXT NOT NULL
      ) STRICT`,
      `CREATE INDEX cache_customer_sort_idx ON cache_customer (sort_text)`,
      `CREATE TABLE cache_product (
        code        INTEGER PRIMARY KEY NOT NULL,
        description TEXT NOT NULL,
        sort_text   TEXT NOT NULL,
        search_text TEXT NOT NULL,
        group_code  INTEGER,
        data        TEXT NOT NULL
      ) STRICT`,
      `CREATE INDEX cache_product_sort_idx ON cache_product (sort_text)`,
      `CREATE INDEX cache_product_group_idx ON cache_product (group_code)`,
      // A local order draft. `client_request_id` is the idempotency key of its create command. Rows are scoped to
      // the account that owns them: a different account signing in on this device never sees them.
      `CREATE TABLE local_order_draft (
        local_id              TEXT PRIMARY KEY NOT NULL,
        owner_account_id      TEXT NOT NULL,
        client_request_id     TEXT NOT NULL UNIQUE,
        customer_code         INTEGER NOT NULL,
        customer_name         TEXT NOT NULL,
        negotiation_type_code INTEGER,
        notes                 TEXT,
        status                TEXT NOT NULL
                              CHECK (status IN ('local_only', 'pending_sync', 'syncing', 'synced', 'sync_error', 'conflict', 'needs_review')),
        remote_id             TEXT,
        remote_version        INTEGER,
        remote_draft_number   INTEGER,
        estimated_total       TEXT,
        last_error            TEXT,
        price_review          TEXT,
        server_snapshot       TEXT,
        created_at            TEXT NOT NULL,
        updated_at            TEXT NOT NULL
      ) STRICT`,
      `CREATE INDEX local_order_draft_owner_idx ON local_order_draft (owner_account_id, updated_at)`,
      `CREATE TABLE local_order_item (
        draft_local_id   TEXT NOT NULL,
        position         INTEGER NOT NULL,
        product_code     INTEGER NOT NULL,
        description      TEXT NOT NULL,
        unit             TEXT NOT NULL,
        quantity         TEXT NOT NULL,
        discount_percent TEXT NOT NULL,
        price_json       TEXT NOT NULL,
        group_code       INTEGER,
        group_name       TEXT,
        PRIMARY KEY (draft_local_id, position)
      ) STRICT`,
      `ALTER TABLE outbox ADD COLUMN draft_local_id TEXT`,
      `ALTER TABLE outbox ADD COLUMN next_attempt_at TEXT`,
      `CREATE INDEX outbox_draft_created_idx ON outbox (draft_local_id, created_at)`,
    ],
  },
  {
    // Dataset isolation (fake / real / sandbox / production must never mix). Expand-only: three columns on each of the
    // two tables that hold seller work. Existing rows get NULL identity = LEGACY_LOCAL (never sent, never deleted).
    // `eligibility` is the outcome of the push guard; 'unchecked' is the state before any check. No table is rebuilt.
    version: 3,
    name: "dataset_identity_and_eligibility",
    statements: [
      `ALTER TABLE local_order_draft ADD COLUMN dataset_environment TEXT`,
      `ALTER TABLE local_order_draft ADD COLUMN dataset_id TEXT`,
      `ALTER TABLE local_order_draft ADD COLUMN eligibility TEXT NOT NULL DEFAULT 'unchecked'
        CHECK (eligibility IN ('unchecked', 'eligible', 'legacy_local', 'environment_mismatch', 'dataset_mismatch', 'owner_mismatch'))`,
      `ALTER TABLE outbox ADD COLUMN dataset_environment TEXT`,
      `ALTER TABLE outbox ADD COLUMN dataset_id TEXT`,
      `ALTER TABLE outbox ADD COLUMN eligibility TEXT NOT NULL DEFAULT 'unchecked'
        CHECK (eligibility IN ('unchecked', 'eligible', 'legacy_local', 'environment_mismatch', 'dataset_mismatch', 'owner_mismatch'))`,
    ],
  },
  {
    // Order TOP and optional carrier chosen on the order (D-A, D-C). Expand-only: two nullable columns. NULL = "not chosen":
    // the server then applies the installation's default TOP on create and keeps the current TOP/carrier on replace.
    version: 4,
    name: "order_top_and_carrier",
    statements: [`ALTER TABLE local_order_draft ADD COLUMN top_code INTEGER`, `ALTER TABLE local_order_draft ADD COLUMN carrier_code INTEGER`],
  },
  {
    // IPI reference of each line (D-D): JSON of `{status:'rate',percentual}` | `{status:'tariff'}` | `{status:'exempt'}` | `{status:'unavailable'}`, for the
    // offline estimate. Expand-only, nullable: NULL = "IPI não disponível". Display only; never sent to the server.
    version: 5,
    name: "order_item_ipi_reference",
    statements: [`ALTER TABLE local_order_item ADD COLUMN ipi_json TEXT`],
  },
  {
    // Freight chosen on the order (CIF | FOB | SEM_FRETE). Expand-only, nullable: NULL = not chosen yet (a draft may stay without it; the server
    // refuses to send an order without a freight type).
    version: 6,
    name: "order_freight_type",
    statements: [`ALTER TABLE local_order_draft ADD COLUMN freight_type TEXT`],
  },
  {
    // Customers created in the app that the ERP has not confirmed yet (customer-write plan A2, F7). Expand-only: one new table,
    // nothing existing is touched. `seq` gives the negative local customer code (-seq) and is never reused (AUTOINCREMENT).
    // `client_request_id` is the local id AND the idempotency key of `POST /customers`, reused verbatim on every retry (SNK-4).
    // `payload` is the request the seller typed (kept intact on a refusal); no credit limit, price table or status exists here (P-20).
    version: 7,
    name: "pending_customer",
    statements: [
      `CREATE TABLE pending_customer (
        seq                 INTEGER PRIMARY KEY AUTOINCREMENT,
        client_request_id   TEXT NOT NULL UNIQUE,
        owner_account_id    TEXT NOT NULL,
        name                TEXT NOT NULL,
        search_text         TEXT NOT NULL,
        document            TEXT NOT NULL,
        payload             TEXT NOT NULL,
        state               TEXT NOT NULL DEFAULT 'queued'
                            CHECK (state IN ('queued', 'sending', 'awaiting_erp', 'confirmed', 'rejected')),
        registration_id     TEXT,
        customer_code       INTEGER,
        rejection_reason    TEXT,
        last_error          TEXT,
        attempts            INTEGER NOT NULL DEFAULT 0,
        next_attempt_at     TEXT,
        dataset_environment TEXT NOT NULL,
        dataset_id          TEXT NOT NULL,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      ) STRICT`,
      `CREATE INDEX pending_customer_owner_state_idx ON pending_customer (owner_account_id, state)`,
      `CREATE INDEX pending_customer_code_idx ON pending_customer (customer_code)`,
    ],
  },
  {
    // I-2 (owner 2026-11-13): after the server CONFIRMS or REFUSES a customer the device keeps no personal data of it. The refused
    // row is identified by its masked document only (the same masking every list already shows); the confirmed one by its ERP code.
    // Expand-only: one nullable column. Rows already confirmed / refused under v7 are erased here (document, name, search text, payload).
    version: 8,
    name: "pending_customer_erase_after_answer",
    statements: [
      `ALTER TABLE pending_customer ADD COLUMN masked_document TEXT`,
      `UPDATE pending_customer SET masked_document = CASE length(document)
         WHEN 11 THEN '***.' || substr(document, 4, 3) || '.' || substr(document, 7, 3) || '-**'
         WHEN 14 THEN '**.***.' || substr(document, 6, 3) || '/' || substr(document, 9, 4) || '-**'
         ELSE substr('**************', 1, max(length(document), 1)) END`,
      `UPDATE pending_customer SET document = '', name = '', search_text = '', payload = 'null' WHERE state IN ('confirmed', 'rejected')`,
    ],
  },
  {
    // Owner 2026-11-13: the device keeps the list price of every product in EACH price table of the visible customers, so the
    // catalog can be filtered per customer's table fully offline. `price_json` is the list-price context the API delivered
    // (unit price, table, version); a product appears for a table only when its row here is priced above zero. Expand-only,
    // a cache the pull replaces (never edited locally, never holds cost or margin: P-20).
    version: 9,
    name: "cache_table_price",
    statements: [
      `CREATE TABLE cache_table_price (
        table_code   INTEGER NOT NULL,
        product_code INTEGER NOT NULL,
        price_json   TEXT NOT NULL,
        PRIMARY KEY (table_code, product_code)
      ) STRICT, WITHOUT ROWID`,
    ],
  },
];
