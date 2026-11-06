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

export const syncRefreshStatuses = ['pending', 'running', 'done'] as const;
export type SyncRefreshStatus = (typeof syncRefreshStatuses)[number];

/**
 * D-AB B3: one on-demand "Atualizar dados" request. The API inserts it (`pending`); the worker claims it, runs the
 * read-only steps and writes the progress into `steps` (counts and masked reasons only, never row content).
 * At most one is `pending`/`running` at a time (partial unique index): a second request gets the same row.
 */
export const syncRefresh = pgTable(
  'sync_refresh',
  {
    id: uuid('id').primaryKey(),
    requestedBy: uuid('requested_by').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status').notNull().default('pending'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** Last time the worker advanced this run (claim or any step write); the expiry of a stuck run reads it (D-AD). */
    progressAt: timestamp('progress_at', { withTimezone: true }),
    steps: jsonb('steps').notNull().default(sql`'[]'::jsonb`),
  },
  (t) => [
    check('sync_refresh_status_chk', sql`${t.status} in (${inList(syncRefreshStatuses)})`),
    uniqueIndex('sync_refresh_active_uq')
      .on(sql`(1)`)
      .where(sql`${t.status} in ('pending', 'running')`),
    // Serves: the latest refresh (cooldown) and the worker's claim.
    index('sync_refresh_requested_idx').on(t.requestedAt),
  ],
);
