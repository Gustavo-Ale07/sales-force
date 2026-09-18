// Module: integration — outbox as the business record of every ERP delivery (STACK-6).
// Foundation only: nothing enqueues into it in this slice.
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

export const outboxStatuses = ['pending', 'processing', 'confirmed', 'rejected', 'unknown'] as const;
export type OutboxStatus = (typeof outboxStatuses)[number];

export const integrationOutbox = pgTable(
  'integration_outbox',
  {
    id: uuid('id').primaryKey(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    operation: text('operation').notNull(),
    payload: jsonb('payload').notNull(),
    /** Origin id sent to the ERP for duplicate protection (SNK-4/SNK-5); NULL until defined. */
    originId: text('origin_id'),
    status: text('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lastErrorClass: text('last_error_class'),
    lastErrorMessage: text('last_error_message'),
    erpReference: text('erp_reference'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('integration_outbox_status_chk', sql`${t.status} in (${inList(outboxStatuses)})`),
    check('integration_outbox_attempt_count_chk', sql`${t.attemptCount} >= 0`),
    // A given origin id is delivered at most once (NULLs allowed).
    uniqueIndex('integration_outbox_origin_id_uq').on(t.originId),
    // Serves: worker picking due work (status pending, next_attempt_at <= now), oldest first.
    index('integration_outbox_due_idx')
      .on(t.nextAttemptAt, t.createdAt)
      .where(sql`${t.status} = 'pending'`),
    // Serves: outbox state of an aggregate (order detail / reconciliation).
    index('integration_outbox_aggregate_idx').on(t.aggregateType, t.aggregateId),
    // Serves: integration status page (counts by status).
    index('integration_outbox_status_idx').on(t.status, t.updatedAt.desc()),
  ],
);
