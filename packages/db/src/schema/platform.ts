// Module: platform — installation configuration snapshots and sync state.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { inList } from './_util.js';

export const configurationSourceKinds = ['sankhya', 'bootstrap-file', 'demo'] as const;
export type ConfigurationSourceKind = (typeof configurationSourceKinds)[number];

export const syncStatuses = ['idle', 'running', 'succeeded', 'failed'] as const;
export type SyncStatus = (typeof syncStatuses)[number];

/** Versioned, immutable snapshots of InstallationConfiguration (CFG-1). Exactly one is current. */
export const installationConfigurationVersion = pgTable(
  'installation_configuration_version',
  {
    id: uuid('id').primaryKey(),
    versionLabel: text('version_label').notNull(),
    sourceKind: text('source_kind').notNull(),
    payload: jsonb('payload').notNull(),
    contentHash: text('content_hash').notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull(),
    isCurrent: boolean('is_current').notNull().default(false),
  },
  (t) => [
    check(
      'installation_configuration_version_source_kind_chk',
      sql`${t.sourceKind} in (${inList(configurationSourceKinds)})`,
    ),
    // At most one current row. Serves: "SELECT ... WHERE is_current" (single-row lookup).
    uniqueIndex('installation_configuration_version_one_current_uq')
      .on(t.isCurrent)
      .where(sql`${t.isCurrent}`),
    // Serves: "was this snapshot already stored?" (hash-diff before inserting a new version).
    index('installation_configuration_version_content_hash_idx').on(t.contentHash),
  ],
);

/** Per-entity synchronization state (mirror sync jobs). Sync state is not part of the config snapshot. */
export const syncState = pgTable(
  'sync_state',
  {
    entity: text('entity').primaryKey(),
    status: text('status').notNull().default('idle'),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    cursor: jsonb('cursor'),
    lastFullReconcileAt: timestamp('last_full_reconcile_at', { withTimezone: true }),
    rowCount: integer('row_count'),
    lastErrorClass: text('last_error_class'),
    lastErrorMessage: text('last_error_message'),
  },
  (t) => [
    check('sync_state_status_chk', sql`${t.status} in (${inList(syncStatuses)})`),
    check('sync_state_row_count_chk', sql`${t.rowCount} is null or ${t.rowCount} >= 0`),
  ],
);
