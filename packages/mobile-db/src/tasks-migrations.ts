import type { Migration } from "./migrator";

/**
 * Local migrations 20-22 (RF-ACT / RF-NOT). Expand-only. No cost or margin (P-20).
 * 20: `local_task`, the device copy of the seller's tasks and, in the same row, the outbox of the offline commands (create, complete, cancel).
 * 21: `local_notification`, the cache of the notification central (read offline).
 * 22: `push_registration`, the Expo token last sent to the server per account (a token is not a secret credential, but it is never logged).
 */
export const taskMigrations: readonly Migration[] = [
  {
    version: 20,
    name: "local_task",
    statements: [
      `CREATE TABLE local_task (
        id                   TEXT PRIMARY KEY,
        owner_account_id     TEXT NOT NULL,
        dataset_environment  TEXT NOT NULL,
        dataset_id           TEXT NOT NULL,
        task_type            TEXT NOT NULL,
        title                TEXT NOT NULL,
        description          TEXT,
        due_at               TEXT NOT NULL,
        reminder_lead_minutes INTEGER,
        customer_code        INTEGER,
        customer_name        TEXT,
        status               TEXT NOT NULL,
        completed_at         TEXT,
        version              INTEGER NOT NULL DEFAULT 1,
        created_at           TEXT NOT NULL,
        updated_at           TEXT NOT NULL,
        sync_state           TEXT NOT NULL,
        pending_create       INTEGER NOT NULL DEFAULT 0,
        pending_complete_at  TEXT,
        pending_cancel       INTEGER NOT NULL DEFAULT 0,
        last_error           TEXT,
        attempts             INTEGER NOT NULL DEFAULT 0,
        seq                  INTEGER NOT NULL DEFAULT 0
      ) STRICT`,
      `CREATE INDEX idx_local_task_owner ON local_task (owner_account_id, dataset_environment, dataset_id, status, due_at)`,
      `CREATE INDEX idx_local_task_sync ON local_task (owner_account_id, sync_state, seq)`,
    ],
  },
  {
    version: 21,
    name: "local_notification",
    statements: [
      `CREATE TABLE local_notification (
        id                   TEXT PRIMARY KEY,
        owner_account_id     TEXT NOT NULL,
        category             TEXT NOT NULL,
        title                TEXT NOT NULL,
        body                 TEXT NOT NULL,
        ref_type             TEXT NOT NULL,
        ref_id               TEXT NOT NULL,
        read_at              TEXT,
        created_at           TEXT NOT NULL,
        read_pending         INTEGER NOT NULL DEFAULT 0
      ) STRICT`,
      `CREATE INDEX idx_local_notification_owner ON local_notification (owner_account_id, created_at)`,
    ],
  },
  {
    version: 22,
    name: "push_registration",
    statements: [
      `CREATE TABLE push_registration (
        owner_account_id     TEXT PRIMARY KEY,
        token_hash           TEXT NOT NULL,
        registered_at        TEXT NOT NULL
      ) STRICT`,
    ],
  },
];
