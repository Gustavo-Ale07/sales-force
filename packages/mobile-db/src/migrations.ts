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
];
