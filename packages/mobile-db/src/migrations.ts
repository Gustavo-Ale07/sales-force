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
];
