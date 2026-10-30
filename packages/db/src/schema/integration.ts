// Module: integration — outbox as the business record of every ERP delivery (STACK-6).
// Written by the order delivery flow (SNK-7); the worker is its only consumer.
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

/**
 * Informational sub-step of a delivery (SNK-7 D-3): never part of the state machine, only a hint for
 * the integration panel and the logs. `dry_run` = the payload was built and stored, nothing was sent.
 */
export const outboxSteps = [
  'verifying_origin',
  'sending',
  'linked_existing',
  'waiting_retry',
  'awaiting_confirmation',
  'confirmed',
  'dry_run',
] as const;
export type OutboxStep = (typeof outboxSteps)[number];

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
    /** Informational (SNK-7 D-3). */
    lastStep: text('last_step'),
    lastErrorClass: text('last_error_class'),
    lastErrorMessage: text('last_error_message'),
    erpReference: text('erp_reference'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('integration_outbox_status_chk', sql`${t.status} in (${inList(outboxStatuses)})`),
    check('integration_outbox_attempt_count_chk', sql`${t.attemptCount} >= 0`),
    check('integration_outbox_last_step_chk', sql`${t.lastStep} is null or ${t.lastStep} in (${inList(outboxSteps)})`),
    // A given origin id is delivered at most once (NULLs allowed).
    uniqueIndex('integration_outbox_origin_id_uq').on(t.originId),
    // Serves: worker picking due work (status pending, next_attempt_at <= now), oldest first.
    index('integration_outbox_due_idx')
      .on(t.nextAttemptAt, t.createdAt)
      .where(sql`${t.status} = 'pending'`),
    // Serves: the order delivery sweep (pending or ambiguous rows whose next attempt is due). NULL = parked.
    index('integration_outbox_deliverable_idx')
      .on(t.nextAttemptAt, t.createdAt)
      .where(sql`${t.status} in ('pending', 'unknown') and ${t.nextAttemptAt} is not null`),
    // Serves: outbox state of an aggregate (order detail / reconciliation).
    index('integration_outbox_aggregate_idx').on(t.aggregateType, t.aggregateId),
    // Serves: integration status page (counts by status).
    index('integration_outbox_status_idx').on(t.status, t.updatedAt.desc()),
  ],
);

/**
 * Dry-run record of an order delivery (SNK-7 D-6): the exact CACSP.incluirNota payload the worker WOULD have
 * sent, stored instead of sending. Sanitized: only codes, UUIDs, quantities and values; the note is replaced by
 * its hash. Purged after 30 days by a job. One row per outbox row.
 */
export const integrationOrderDryRun = pgTable(
  'integration_order_dry_run',
  {
    id: uuid('id').primaryKey(),
    outboxId: uuid('outbox_id')
      .notNull()
      .references(() => integrationOutbox.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id').notNull(),
    payload: jsonb('payload').notNull(),
    /** SHA-256 (hex) of the exact request text that would have been sent. */
    payloadHash: text('payload_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('integration_order_dry_run_outbox_uq').on(t.outboxId),
    // Serves: the 30-day purge.
    index('integration_order_dry_run_created_idx').on(t.createdAt),
  ],
);
