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
  {
    // "Enviar pedido" from the app: the seller's request to send the order to the ERP is a persisted command that lives with the
    // draft (NOT an outbox row: the create/replace queue keeps its ordering and coalescing). Expand-only, all nullable/defaulted.
    // send_state: NULL = never asked · requested = waiting for the network / its turn · refused = the server definitively
    // refused (send_code = catalog problem code, send_error = seller text; only the seller re-requests) · submitted = the
    // server took it (send_code = the server order status: queued, sent, unknown, awaiting_approval, approved...).
    version: 10,
    name: "order_send_request",
    statements: [
      `ALTER TABLE local_order_draft ADD COLUMN send_state TEXT CHECK (send_state IS NULL OR send_state IN ('requested', 'refused', 'submitted'))`,
      `ALTER TABLE local_order_draft ADD COLUMN send_code TEXT`,
      `ALTER TABLE local_order_draft ADD COLUMN send_error TEXT`,
      `ALTER TABLE local_order_draft ADD COLUMN send_attempts INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE local_order_draft ADD COLUMN send_next_attempt_at TEXT`,
      `ALTER TABLE local_order_draft ADD COLUMN send_requested_at TEXT`,
    ],
  },
  {
    // Stage of the order following Sankhya (read-only on the device, written only from the server's `erpStage`): the LAST KNOWN
    // stage is kept with the draft so it shows offline. erp_stage = the stage code (filterable); erp_stage_json = the rest
    // (label, sector, numbers, times, read error). Expand-only, all nullable.
    version: 11,
    name: "order_erp_stage",
    statements: [`ALTER TABLE local_order_draft ADD COLUMN erp_stage TEXT`, `ALTER TABLE local_order_draft ADD COLUMN erp_stage_json TEXT`],
  },
  {
    // The unique Sankhya number (NUNOTA) of the order, the only number the seller sees once the order is confirmed. Filled by the
    // submit answer or the status read; read-only on the device. Expand-only, nullable.
    version: 12,
    name: "order_erp_number",
    statements: [`ALTER TABLE local_order_draft ADD COLUMN erp_number INTEGER`],
  },
  {
    // Owner 2026-11-23: product discount ceiling (TGFPRO.DESCMAX, from the catalog pull) kept on each order line so a reopened draft
    // knows it offline, and the one-time "discount above the accepted limit" mark of the order. Expand-only: a nullable column and
    // a defaulted flag; old rows read as no limit / not marked. Display and warning only, never a block or a commercial rule.
    version: 13,
    name: "order_discount_limit",
    statements: [
      `ALTER TABLE local_order_item ADD COLUMN max_discount_percent TEXT`,
      `ALTER TABLE local_order_draft ADD COLUMN discount_over_limit_accepted INTEGER NOT NULL DEFAULT 0 CHECK (discount_over_limit_accepted IN (0, 1))`,
    ],
  },
  {
    // Recovery record (owner 2026-11-23): the autosave of an order still being built is protection against a forced close, not a saved
    // order. Expand-only: a defaulted column; every existing row stays a saved order ('saved') unless the cleanup below proves otherwise.
    // Cleanup of the wrong state seen on devices (autosave had queued a server copy that the server refused): an order that was never
    // confirmed (no send request), never reached the server (no remote id) and sits in `sync_error` cannot be proven saved on purpose,
    // so it becomes a recovery record (kept, never deleted) and its refused commands are dropped (nothing was accepted by the server).
    // Confirmed orders and any order the server holds are never touched.
    version: 14,
    name: "order_recovery_kind",
    statements: [
      `ALTER TABLE local_order_draft ADD COLUMN kind TEXT NOT NULL DEFAULT 'saved' CHECK (kind IN ('saved', 'recovery'))`,
      `UPDATE local_order_draft SET kind = 'recovery', status = 'local_only', last_error = NULL
         WHERE send_state IS NULL AND remote_id IS NULL AND status = 'sync_error' AND erp_number IS NULL`,
      `DELETE FROM outbox WHERE draft_local_id IN (SELECT local_id FROM local_order_draft WHERE kind = 'recovery') AND state IN ('rejected', 'pending')`,
    ],
  },
  {
    // Product group hierarchy (Grupo > Subgrupo > Linha, PAR-1): one row per group as GET /product-groups delivers it (`data` is the JSON,
    // incl. subtreeCodes, the offline filter set). A cache the pull replaces, never edited locally; holds no cost or margin (P-20).
    // Expand-only: a new table, nothing else touched. Whether the tree is hierarchical / has ungrouped products lives in sync_metadata.
    version: 15,
    name: "cache_product_group",
    statements: [
      `CREATE TABLE cache_product_group (
        code      INTEGER PRIMARY KEY,
        sort_text TEXT NOT NULL,
        data      TEXT NOT NULL
      ) STRICT`,
    ],
  },
  {
    // Owner 2026-11-25: the "Precisa de correção" state of a customer registration is gone (a refusal shows on the form, nothing is kept
    // halfway). Rows left in the old refused state are migrated here: nothing typed (erased) -> removed; typed data complete -> queued
    // again under a NEW key (the refused one is history on the server); typed data missing the seller -> held (`needs_seller`) until the
    // manager picks one on the customer sheet. Expand-only: one column with a default; only the old refused rows are rewritten.
    version: 16,
    name: "pending_customer_needs_seller",
    statements: [
      `ALTER TABLE pending_customer ADD COLUMN needs_seller INTEGER NOT NULL DEFAULT 0`,
      `DELETE FROM pending_customer WHERE state = 'rejected' AND payload = 'null'`,
      `UPDATE pending_customer SET needs_seller = 1 WHERE state = 'rejected' AND json_extract(payload, '$.sellerCode') IS NULL AND lower(coalesce(rejection_reason, '')) LIKE '%vendedor%'`,
      `UPDATE pending_customer SET state = 'queued', registration_id = NULL, attempts = 0, rejection_reason = NULL, last_error = NULL, next_attempt_at = NULL,
         client_request_id = lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-a' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))
         WHERE state = 'rejected'`,
    ],
  },
  {
    // Owner 2026-11-26: a customer registration ends confirmed, refused (reason on the row, `rejected`) or discarded; nothing waits forever.
    // Rows of the old flow (the server answered 202 and the device kept waiting for the Sankhya confirmation: `awaiting_erp`) are not
    // resent under a new key (SNK-4: the old registration may exist): they end as refused with the reason on the row, for the seller to
    // discard. Data-only; no schema change; the typed data is erased like any refused row.
    version: 17,
    name: "pending_customer_old_flow_refused",
    statements: [
      `UPDATE pending_customer SET state = 'rejected', rejection_reason = 'Cadastro antigo sem confirmação do Sankhya. Descarte e cadastre de novo.',
         last_error = NULL, next_attempt_at = NULL, needs_seller = 0, document = '', search_text = lower(name), payload = 'null'
         WHERE state = 'awaiting_erp'`,
    ],
  },
  {
    // Owner 2026-11-26: address lists of the new-customer form, read offline: ERP cities, neighborhoods and streets (replaced as a whole
    // by each pull, never edited locally; `search` = lower-case text without accents) and the postal codes (CEP) already looked up on the
    // server, kept to be reused without a connection. Expand-only: four new tables, nothing else touched. No cost or margin (P-20).
    version: 18,
    name: "cache_address_lists",
    statements: [
      `CREATE TABLE cache_city (
        code   INTEGER PRIMARY KEY,
        name   TEXT NOT NULL,
        uf     TEXT NOT NULL,
        ibge   TEXT,
        search TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE cache_neighborhood (
        code   INTEGER PRIMARY KEY,
        name   TEXT NOT NULL,
        search TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE cache_street (
        code   INTEGER PRIMARY KEY,
        name   TEXT NOT NULL,
        kind   TEXT,
        search TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE cache_postal_code (
        cep       TEXT PRIMARY KEY,
        data      TEXT NOT NULL,
        cached_at TEXT NOT NULL
      ) STRICT`,
    ],
  },
];
