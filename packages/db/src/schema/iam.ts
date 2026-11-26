// Module: iam — accounts, sessions, seller links and audit log (dev-safe auth, slice 1 §6).
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { inList } from './_util.js';
import { installationConfigurationVersion } from './platform.js';

/**
 * `technical` (owner 2026-10-02) is a profile separate from `admin`: platform operation, no
 * commercial scope. Like `admin` it carries no seller link (enforced for `technical` by the
 * database, migration 0007; `admin` is still app-level only).
 */
export const accountRoles = ['admin', 'manager', 'seller', 'technical', 'operations'] as const;
export type AccountRole = (typeof accountRoles)[number];

export const accountStatuses = ['active', 'disabled'] as const;
export type AccountStatus = (typeof accountStatuses)[number];

export const account = pgTable(
  'account',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    /** Argon2id hash (encoded string). Never a plain or reversible value. */
    passwordHash: text('password_hash').notNull(),
    role: text('role').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Stable id of the user in the external directory (the ERP user code, as text), set only for accounts
     * that sign in through the identity verifier. Null for local accounts (admin/technical). Never the login text.
     */
    externalUserId: text('external_user_id'),
  },
  (t) => [
    check('account_role_chk', sql`${t.role} in (${inList(accountRoles)})`),
    check('account_status_chk', sql`${t.status} in (${inList(accountStatuses)})`),
    // Case-insensitive unique email. Serves: login lookup by lower(email).
    uniqueIndex('account_email_lower_uq').on(sql`lower(${t.email})`),
    // Serves: external login (find the account of a verified directory user). One account per directory user.
    uniqueIndex('account_external_user_id_uq').on(t.externalUserId).where(sql`${t.externalUserId} is not null`),
  ],
);

export const session = pgTable(
  'session',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    /** Hash of the opaque token; the token itself is never stored. */
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** The mobile device the session was opened from (null for the site and for sessions that predate the device registry). */
    deviceId: uuid('device_id').references((): AnyPgColumn => device.id, { onDelete: 'set null' }),
  },
  (t) => [
    // Serves: revoke the sessions of a device; join to its status on every request.
    index('session_device_id_idx').on(t.deviceId),
    // Serves: every authenticated request (lookup by token hash).
    uniqueIndex('session_token_hash_uq').on(t.tokenHash),
    // Serves: revoke all sessions of an account; list active sessions.
    index('session_account_id_idx').on(t.accountId),
    // Serves: periodic purge of expired sessions.
    index('session_expires_at_idx').on(t.expiresAt),
  ],
);

export const deviceStatuses = ['pending', 'approved', 'revoked'] as const;
export const devicePlatforms = ['android', 'ios'] as const;

/** Mobile device registry (AUTH-2, RF-IAM-7). One row per app installation of an account; its status gates every request of its sessions. */
export const device = pgTable(
  'device',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    /** Random id the app keeps in its secure store; identifies the installation. Not a secret and never a hardware id. */
    installId: text('install_id').notNull(),
    label: text('label').notNull(),
    platform: text('platform').notNull(),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** Last successful synchronization reported by the device (informational; the lock is enforced on the device). */
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by').references(() => account.id),
  },
  (t) => [
    check('device_platform_chk', sql`${t.platform} in (${inList(devicePlatforms)})`),
    check('device_status_chk', sql`${t.status} in (${inList(deviceStatuses)})`),
    check('device_install_id_chk', sql`${t.installId} ~ '^[A-Za-z0-9-]{8,64}$'`),
    // Serves: registration lookup at login (one row per account and installation).
    uniqueIndex('device_account_install_uq').on(t.accountId, t.installId),
    // Serves: the administration list by status, newest first.
    index('device_status_created_idx').on(t.status, t.createdAt),
  ],
);

/** Installation-wide device settings (single row), edited in Configuracoes of the site. */
export const deviceSetting = pgTable(
  'device_setting',
  {
    id: smallint('id').primaryKey().default(1),
    offlineMaxDays: integer('offline_max_days').notNull().default(7),
    maxActiveDevices: integer('max_active_devices').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => account.id),
  },
  (t) => [
    check('device_setting_singleton_chk', sql`${t.id} = 1`),
    check('device_setting_offline_max_days_chk', sql`${t.offlineMaxDays} between 1 and 60`),
    check('device_setting_max_active_devices_chk', sql`${t.maxActiveDevices} between 1 and 5`),
  ],
);

/** Account -> Sankhya seller mapping (CFG-2; shape PROPOSED, U-10). One seller per account. */
export const accountSellerLink = pgTable(
  'account_seller_link',
  {
    accountId: uuid('account_id')
      .primaryKey()
      .references(() => account.id, { onDelete: 'cascade' }),
    sellerCode: integer('seller_code').notNull(),
    configVersionId: uuid('config_version_id')
      .notNull()
      .references(() => installationConfigurationVersion.id),
    /**
     * Who set the link: `manual` (an administrator, authoritative, never changed by a sync) or `sankhya_auto` (derived from the
     * official ERP user -> seller relation at first login; the reconciliation may move or revoke it when the ERP changes).
     */
    source: text('source').notNull().default('manual'),
  },
  (t) => [
    // Serves: seller-scope resolution ("which accounts are linked to seller X").
    index('account_seller_link_seller_code_idx').on(t.sellerCode),
    check('account_seller_link_source_chk', sql`${t.source} in ('manual', 'sankhya_auto')`),
    index('account_seller_link_config_version_id_idx').on(t.configVersionId),
    // 0 is the "no seller" placeholder, never a seller: a link to it must not grant a scope (F2).
    check('account_seller_link_seller_code_chk', sql`${t.sellerCode} >= 1`),
  ],
);

/**
 * Profile photo metadata: one row per account (replace on change, delete on removal). The bytes live in object storage
 * (P-17: no bytea) under `storage_key`; the stored rendition is always the server-made square WebP (EXIF/metadata
 * stripped), never the upload. Not mirrored to Sankhya and not part of the sync stream.
 */
export const accountPhoto = pgTable(
  'account_photo',
  {
    accountId: uuid('account_id')
      .primaryKey()
      .references(() => account.id, { onDelete: 'cascade' }),
    contentType: text('content_type').notNull(),
    byteLength: integer('byte_length').notNull(),
    /** Square side in pixels of the stored rendition. */
    sizePx: integer('size_px').notNull(),
    /** sha256 hex (64 lowercase chars) of the stored bytes; its prefix is the public `version` and the ETag. */
    contentHash: text('content_hash').notNull(),
    /** Opaque key inside the object store: account-photos/<accountId>/<sha256>. */
    storageKey: text('storage_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('account_photo_content_type_chk', sql`${t.contentType} in ('image/webp', 'image/jpeg', 'image/png')`),
    check('account_photo_byte_length_chk', sql`${t.byteLength} > 0`),
    check('account_photo_size_px_chk', sql`${t.sizePx} > 0`),
    check('account_photo_content_hash_chk', sql`${t.contentHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

/**
 * Login throttling state (RF-IAM-2; Stage 1b). One row per throttle key: a hash of the normalized
 * e-mail (progressive lockout, identical for existing and unknown accounts so it never reveals
 * which e-mails are registered) or a client address (failure rate limit). Counters live in
 * PostgreSQL (no Redis). Rows carry no credentials; the e-mail is stored only as a SHA-256 hash.
 */
export const authThrottle = pgTable(
  'auth_throttle',
  {
    /** `email:<sha256 hex>` or `ip:<address>`. */
    key: text('key').primaryKey(),
    /** Failures counted in the current window (reset by a success or when the window elapses). */
    failures: integer('failures').notNull().default(0),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull(),
    /** Set while the key is locked out; null otherwise. */
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    /** Consecutive lockouts since the last success; drives the escalating duration. */
    lockoutCount: integer('lockout_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('auth_throttle_failures_chk', sql`${t.failures} >= 0`),
    check('auth_throttle_lockout_count_chk', sql`${t.lockoutCount} >= 0`),
    // Serves: periodic purge of stale throttle rows.
    index('auth_throttle_updated_at_idx').on(t.updatedAt),
  ],
);

/** Append-only audit trail (auth events and account administration; never credentials or tokens). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    /** Null for events without a resolved account (e.g. login attempt with an unknown email). */
    actorAccountId: uuid('actor_account_id').references(() => account.id),
    action: text('action').notNull(),
    detail: jsonb('detail'),
  },
  (t) => [
    // Serves: audit review, newest first; per-actor and per-action filters.
    index('audit_log_at_idx').on(t.at.desc()),
    index('audit_log_actor_at_idx').on(t.actorAccountId, t.at.desc()),
    index('audit_log_action_at_idx').on(t.action, t.at.desc()),
  ],
);
