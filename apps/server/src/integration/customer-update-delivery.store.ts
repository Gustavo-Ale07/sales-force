import { erpCustomer, integrationOutbox, type Database } from '@salesforce/db';
import { and, asc, eq, inArray, isNotNull, lt, lte, sql } from 'drizzle-orm';
import { CUSTOMER_UPDATE_AGGREGATE, CUSTOMER_UPDATE_OPERATION } from '../customers/customer-update-state.js';
import { AUDIT_ACTIONS, type AuditService } from '../iam/audit.service.js';
import { maskStoredError } from '../observability/mask-error-message.js';

const MESSAGE_MAX = 500;

/** One claimed `customer.update` outbox row. */
export interface ClaimedCustomerUpdate {
  readonly outboxId: string;
  readonly updateId: string;
  readonly payload: unknown;
  /** Attempts used including the current one. */
  readonly attemptCount: number;
  readonly previousStatus: 'pending' | 'unknown';
}

export interface CustomerUpdateFailureRecord {
  readonly claimed: ClaimedCustomerUpdate;
  readonly kind: 'reject' | 'park' | 'retry';
  readonly status: 'rejected' | 'unknown' | 'pending';
  readonly errorClass: string;
  readonly errorCode: string;
  readonly message: string;
  readonly nextAttemptAt: Date | null;
  /** `false` = an authentication failure: the attempt is given back. */
  readonly consumesAttempt: boolean;
  readonly customerCode: number | null;
  readonly at: Date;
}

export interface CustomerUpdateConfirmation {
  readonly claimed: ClaimedCustomerUpdate;
  readonly customerCode: number;
  /** The editable columns as the ERP stores them (the reread). */
  readonly fields: { readonly phone: string | null; readonly email: string | null; readonly notes: string | null; readonly priceTableCode: number | null };
  readonly at: Date;
}

/** Persistence of the edit delivery. Every method is its own short transaction; none calls the ERP. */
export interface CustomerUpdateDeliveryStore {
  recoverStale(now: Date, cutoff: Date): Promise<number>;
  claimNext(now: Date): Promise<ClaimedCustomerUpdate | null>;
  markSending(outboxId: string, at: Date): Promise<void>;
  confirm(input: CustomerUpdateConfirmation): Promise<void>;
  fail(input: CustomerUpdateFailureRecord): Promise<void>;
}

export class DrizzleCustomerUpdateDeliveryStore implements CustomerUpdateDeliveryStore {
  constructor(
    private readonly database: Database,
    private readonly audit: Pick<AuditService, 'record'>,
  ) {}

  async recoverStale(now: Date, cutoff: Date): Promise<number> {
    return this.database.transaction(async (tx) => {
      const stale = await tx
        .select({ id: integrationOutbox.id })
        .from(integrationOutbox)
        .where(
          and(
            eq(integrationOutbox.aggregateType, CUSTOMER_UPDATE_AGGREGATE),
            eq(integrationOutbox.operation, CUSTOMER_UPDATE_OPERATION),
            eq(integrationOutbox.status, 'processing'),
            lt(integrationOutbox.updatedAt, cutoff),
          ),
        )
        .for('update', { skipLocked: true });
      for (const item of stale) {
        await tx
          .update(integrationOutbox)
          .set({
            status: 'unknown',
            nextAttemptAt: now,
            lastStep: 'waiting_retry',
            lastErrorClass: 'interrupted',
            lastErrorMessage: 'The worker stopped during the attempt; the customer will be reread before any resend.',
            updatedAt: now,
          })
          .where(eq(integrationOutbox.id, item.id));
      }
      return stale.length;
    });
  }

  async claimNext(now: Date): Promise<ClaimedCustomerUpdate | null> {
    return this.database.transaction(async (tx) => {
      const [due] = await tx
        .select()
        .from(integrationOutbox)
        .where(
          and(
            eq(integrationOutbox.aggregateType, CUSTOMER_UPDATE_AGGREGATE),
            eq(integrationOutbox.operation, CUSTOMER_UPDATE_OPERATION),
            inArray(integrationOutbox.status, ['pending', 'unknown']),
            isNotNull(integrationOutbox.nextAttemptAt),
            lte(integrationOutbox.nextAttemptAt, now),
          ),
        )
        .orderBy(asc(integrationOutbox.nextAttemptAt), asc(integrationOutbox.createdAt))
        .limit(1)
        .for('update', { skipLocked: true });
      if (due === undefined) return null;
      const previousStatus = due.status === 'unknown' ? 'unknown' : 'pending';
      const [row] = await tx
        .update(integrationOutbox)
        .set({ status: 'processing', attemptCount: sql`${integrationOutbox.attemptCount} + 1`, lastStep: 'verifying_origin', updatedAt: now })
        .where(eq(integrationOutbox.id, due.id))
        .returning();
      if (row === undefined) return null;
      return { outboxId: row.id, updateId: row.aggregateId, payload: row.payload, attemptCount: row.attemptCount, previousStatus };
    });
  }

  async markSending(outboxId: string, at: Date): Promise<void> {
    await this.database.update(integrationOutbox).set({ lastStep: 'sending', updatedAt: at }).where(eq(integrationOutbox.id, outboxId));
  }

  async confirm(input: CustomerUpdateConfirmation): Promise<void> {
    const { claimed, customerCode, fields, at } = input;
    await this.database.transaction(async (tx) => {
      await tx
        .update(integrationOutbox)
        .set({ status: 'confirmed', nextAttemptAt: null, lastStep: 'confirmed', lastErrorClass: null, lastErrorMessage: null, erpReference: String(customerCode), updatedAt: at })
        .where(eq(integrationOutbox.id, claimed.outboxId));
      // The mirror shows the edit at once; the next customers sync rewrites it from the ERP when its hash differs.
      await tx.update(erpCustomer).set({ phone: fields.phone, email: fields.email, ...(fields.priceTableCode === null ? {} : { priceTableCode: fields.priceTableCode }) }).where(eq(erpCustomer.code, customerCode));
      await this.audit.record(
        { action: AUDIT_ACTIONS.customerUpdateDelivered, actorAccountId: null, detail: { updateId: claimed.updateId, outboxId: claimed.outboxId, customerCode, attempts: claimed.attemptCount } },
        tx,
      );
    });
  }

  async fail(input: CustomerUpdateFailureRecord): Promise<void> {
    const { claimed, at } = input;
    await this.database.transaction(async (tx) => {
      await tx
        .update(integrationOutbox)
        .set({
          status: input.status,
          nextAttemptAt: input.nextAttemptAt,
          lastStep: input.kind === 'reject' ? null : 'waiting_retry',
          lastErrorClass: input.errorClass,
          lastErrorMessage: maskStoredError(`${input.errorCode}: ${input.message}`).slice(0, MESSAGE_MAX),
          ...(input.customerCode === null ? {} : { erpReference: String(input.customerCode) }),
          ...(input.consumesAttempt ? {} : { attemptCount: sql`greatest(${integrationOutbox.attemptCount} - 1, 0)` }),
          updatedAt: at,
        })
        .where(eq(integrationOutbox.id, claimed.outboxId));
      if (input.kind === 'reject' || input.kind === 'park') {
        await this.audit.record(
          {
            action: input.kind === 'reject' ? AUDIT_ACTIONS.customerUpdateRejected : AUDIT_ACTIONS.customerUpdateUnknown,
            actorAccountId: null,
            detail: { updateId: claimed.updateId, outboxId: claimed.outboxId, errorClass: input.errorClass, errorCode: input.errorCode },
          },
          tx,
        );
      }
    });
  }
}
