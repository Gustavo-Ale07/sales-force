// Module: tasks (RF-ACT-1..3). One row per task; the creator's `client_request_id` makes creation idempotent
// (offline replay returns the same task). Visibility (own tasks / manager sees all) is decided by the service.
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { account } from './iam.js';
import { inList } from './_util.js';

export const taskTypes = ['call', 'visit', 'email', 'whatsapp', 'meeting', 'other'] as const;
export const taskStatuses = ['pending', 'completed', 'cancelled'] as const;

export const activityTask = pgTable(
  'activity_task',
  {
    /** UUIDv7 generated outside PostgreSQL (DATA-1); the device may generate it for an offline creation. */
    id: uuid('id').primaryKey(),
    clientRequestId: uuid('client_request_id').notNull(),
    /** SHA-256 (hex) of the canonical create payload: same request id with another payload is a conflict. */
    requestHash: text('request_hash').notNull(),
    assigneeAccountId: uuid('assignee_account_id')
      .notNull()
      .references(() => account.id),
    createdByAccountId: uuid('created_by_account_id')
      .notNull()
      .references(() => account.id),
    type: text('type').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    /** Minutes before `due_at` at which the reminder fires; NULL = no reminder. */
    reminderLeadMinutes: smallint('reminder_lead_minutes'),
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
    /** Customer code as mirrored (no FK: mirror rows are soft-deleted and owned by another module). */
    customerCode: integer('customer_code'),
    status: text('status').notNull().default('pending'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedByAccountId: uuid('completed_by_account_id').references(() => account.id),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('activity_task_type_chk', sql`${t.type} in (${inList(taskTypes)})`),
    check('activity_task_status_chk', sql`${t.status} in (${inList(taskStatuses)})`),
    check('activity_task_completed_chk', sql`(${t.status} = 'completed') = (${t.completedAt} is not null)`),
    // Serves: idempotent create (replay lookup per creator).
    uniqueIndex('activity_task_creator_request_uq').on(t.createdByAccountId, t.clientRequestId),
    // Serves: "my tasks" ordered by due date, filtered by status.
    index('activity_task_assignee_due_idx').on(t.assigneeAccountId, t.status, t.dueAt),
    // Serves: the reminder sweep (pending tasks with a reminder not sent yet).
    index('activity_task_reminder_idx')
      .on(t.dueAt)
      .where(sql`${t.status} = 'pending' and ${t.reminderLeadMinutes} is not null and ${t.remindedAt} is null`),
    // Serves: tasks of one customer.
    index('activity_task_customer_idx').on(t.customerCode).where(sql`${t.customerCode} is not null`),
  ],
);
