// Module: iam — accounts, sessions, seller links and audit log (dev-safe auth, slice 1 §6).
import { sql } from 'drizzle-orm';
import {
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
import { installationConfigurationVersion } from './platform.js';

export const accountRoles = ['admin', 'manager', 'seller'] as const;
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
  },
  (t) => [
    check('account_role_chk', sql`${t.role} in (${inList(accountRoles)})`),
    check('account_status_chk', sql`${t.status} in (${inList(accountStatuses)})`),
    // Case-insensitive unique email. Serves: login lookup by lower(email).
    uniqueIndex('account_email_lower_uq').on(sql`lower(${t.email})`),
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
  },
  (t) => [
    // Serves: every authenticated request (lookup by token hash).
    uniqueIndex('session_token_hash_uq').on(t.tokenHash),
    // Serves: revoke all sessions of an account; list active sessions.
    index('session_account_id_idx').on(t.accountId),
    // Serves: periodic purge of expired sessions.
    index('session_expires_at_idx').on(t.expiresAt),
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
  },
  (t) => [
    // Serves: seller-scope resolution ("which accounts are linked to seller X").
    index('account_seller_link_seller_code_idx').on(t.sellerCode),
    index('account_seller_link_config_version_id_idx').on(t.configVersionId),
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
