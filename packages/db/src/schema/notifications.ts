// Module: notifications (RF-NOT-1/2). The central of each account plus the push devices. Content is built from
// allow-listed fields only (packages/domain notifications.ts): never cost, margin or another account's data.
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { account } from './iam.js';
import { inList } from './_util.js';

export const notificationCategories = ['order', 'customer', 'task'] as const;
export const notificationPushStates = ['pending', 'sent', 'skipped', 'failed'] as const;

export const notification = pgTable(
  'notification',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    category: text('category').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** What the notification points to (order id, customer registration id, task id). */
    refType: text('ref_type').notNull(),
    refId: text('ref_id').notNull(),
    /** One notification per (account, event): generation is idempotent. */
    dedupeKey: text('dedupe_key').notNull(),
    pushState: text('push_state').notNull().default('pending'),
    pushAttempts: integer('push_attempts').notNull().default(0),
    pushedAt: timestamp('pushed_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('notification_category_chk', sql`${t.category} in (${inList(notificationCategories)})`),
    check('notification_push_state_chk', sql`${t.pushState} in (${inList(notificationPushStates)})`),
    uniqueIndex('notification_account_dedupe_uq').on(t.accountId, t.dedupeKey),
    // Serves: the central, newest first, and the unread count.
    index('notification_account_created_idx').on(t.accountId, t.createdAt.desc()),
    index('notification_account_unread_idx').on(t.accountId).where(sql`${t.readAt} is null`),
    // Serves: the push sweep.
    index('notification_push_pending_idx').on(t.createdAt).where(sql`${t.pushState} = 'pending'`),
  ],
);

export const pushDevice = pgTable(
  'push_device',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    /** Expo push token; one row per token (a token moves to the account that registered it last). */
    token: text('token').notNull(),
    platform: text('platform').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when Expo reported the token as no longer valid, or the account signed out. */
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
  },
  (t) => [
    check('push_device_platform_chk', sql`${t.platform} in ('android', 'ios')`),
    uniqueIndex('push_device_token_uq').on(t.token),
    index('push_device_account_idx').on(t.accountId).where(sql`${t.disabledAt} is null`),
  ],
);
