import { createHash } from 'node:crypto';
import {
  customerRegistration,
  customerRegistrationStatuses,
  erpCustomer,
  integrationOutbox,
  type CustomerRegistrationStatus,
  type Database,
} from '@salesforce/db';
import type { Customer } from '@salesforce/domain';
import { and, asc, eq, inArray, isNotNull, lt, lte, sql } from 'drizzle-orm';
import { CUSTOMER_UPSERT_AGGREGATE, CUSTOMER_UPSERT_OPERATION } from '../customers/customer-registration.repository.js';
import { AUDIT_ACTIONS, type AuditService } from '../iam/audit.service.js';
import { maskStoredError } from '../observability/mask-error-message.js';
import type { CustomerUpsertCommand } from './customer-delivery.service.js';

const MESSAGE_MAX = 500;

/** One claimed `customer.upsert` outbox row with the state of its registration. */
export interface ClaimedCustomerCommand {
  readonly outboxId: string;
  readonly registrationId: string;
  readonly originKey: string;
  readonly payload: unknown;
  /** Attempts used including the current one. */
  readonly attemptCount: number;
  readonly previousStatus: 'pending' | 'unknown';
  /** The ERP code when an earlier attempt already learned it. */
  readonly erpReference: string | null;
  readonly registrationStatus: CustomerRegistrationStatus | null;
}

export interface CustomerFailureRecord {
  readonly claimed: ClaimedCustomerCommand;
  readonly kind: 'reject' | 'park' | 'retry';
  /** Outbox status afterwards. */
  readonly status: 'rejected' | 'unknown' | 'pending';
  readonly errorClass: string;
  readonly errorCode: string;
  readonly message: string;
  readonly nextAttemptAt: Date | null;
  /** `false` = an authentication failure: the attempt is given back (repeating it can lock the integration user). */
  readonly consumesAttempt: boolean;
  readonly erpCode?: number;
  readonly at: Date;
}

export interface CustomerConfirmation {
  readonly claimed: ClaimedCustomerCommand;
  readonly erpCode: number;
  /** The partner as the ERP stores it (the reread). */
  readonly partner: Customer;
  readonly command: CustomerUpsertCommand;
  readonly at: Date;
}

/** Persistence of the delivery. Every method is its own short transaction; none calls the ERP. */
export interface CustomerDeliveryStore {
  /** Rows left `processing` by a dead worker become `unknown` (re-verified by origin before any write). */
  recoverStale(now: Date, cutoff: Date): Promise<number>;
  claimNext(now: Date): Promise<ClaimedCustomerCommand | null>;
  markSending(outboxId: string, at: Date): Promise<void>;
  /** Outbox `confirmed`, registration `confirmed` with the real code, mirror row, audit: one transaction. */
  confirm(input: CustomerConfirmation): Promise<void>;
  /** Outcome of a failed attempt (reject / park / retry): outbox, registration and audit in one transaction. */
  fail(input: CustomerFailureRecord): Promise<void>;
}

export class DrizzleCustomerDeliveryStore implements CustomerDeliveryStore {
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
            eq(integrationOutbox.aggregateType, CUSTOMER_UPSERT_AGGREGATE),
            eq(integrationOutbox.operation, CUSTOMER_UPSERT_OPERATION),
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
            lastErrorMessage: 'The worker stopped during the attempt; the customer will be verified by origin id before any write.',
            updatedAt: now,
          })
          .where(eq(integrationOutbox.id, item.id));
      }
      return stale.length;
    });
  }

  async claimNext(now: Date): Promise<ClaimedCustomerCommand | null> {
    return this.database.transaction(async (tx) => {
      const [due] = await tx
        .select()
        .from(integrationOutbox)
        .where(
          and(
            eq(integrationOutbox.aggregateType, CUSTOMER_UPSERT_AGGREGATE),
            eq(integrationOutbox.operation, CUSTOMER_UPSERT_OPERATION),
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
      const [registration] = await tx
        .select({ status: customerRegistration.status })
        .from(customerRegistration)
        .where(eq(customerRegistration.id, row.aggregateId))
        .limit(1);
      return {
        outboxId: row.id,
        registrationId: row.aggregateId,
        originKey: row.originId ?? '',
        payload: row.payload,
        attemptCount: row.attemptCount,
        previousStatus,
        erpReference: row.erpReference,
        registrationStatus: (customerRegistrationStatuses as readonly string[]).includes(registration?.status ?? '')
          ? (registration?.status as CustomerRegistrationStatus)
          : null,
      };
    });
  }

  async markSending(outboxId: string, at: Date): Promise<void> {
    await this.database.update(integrationOutbox).set({ lastStep: 'sending', updatedAt: at }).where(eq(integrationOutbox.id, outboxId));
  }

  async confirm(input: CustomerConfirmation): Promise<void> {
    const { claimed, erpCode, partner, command, at } = input;
    await this.database.transaction(async (tx) => {
      await tx
        .update(integrationOutbox)
        .set({
          status: 'confirmed',
          nextAttemptAt: null,
          lastStep: 'confirmed',
          lastErrorClass: null,
          lastErrorMessage: null,
          erpReference: String(erpCode),
          updatedAt: at,
        })
        .where(eq(integrationOutbox.id, claimed.outboxId));
      await tx
        .update(customerRegistration)
        .set({ status: 'confirmed', erpCustomerCode: erpCode, rejectionCode: null, updatedAt: at })
        .where(eq(customerRegistration.id, claimed.registrationId));
      // The mirror gets the customer at once, from the reread, so the app does not wait for the next customers sync.
      // A later sync rewrites the row from the ERP when its hash differs (the ERP stays the system of record).
      const content = {
        name: partner.name,
        tradeName: partner.tradeName,
        taxId: command.document,
        personType: command.personType === 'company' ? 'J' : 'F',
        email: command.email,
        phone: command.phone,
        sellerCode: partner.sellerCode,
        priceTableCode: partner.priceTableCode,
        active: partner.active,
        blockedRaw: partner.blocked ? 'true' : 'false',
      };
      const contentHash = createHash('sha256').update(JSON.stringify(['force-delivery', content])).digest('hex');
      const values = {
        code: erpCode,
        ...content,
        creditLimit: partner.creditLimit,
        isCustomer: true,
        contentHash,
        sourceChangedAt: null,
        syncedAt: at,
        deletedAt: null,
      };
      const { code: _code, ...update } = values;
      void _code;
      await tx.insert(erpCustomer).values(values).onConflictDoUpdate({ target: erpCustomer.code, set: update });
      await this.audit.record(
        { action: AUDIT_ACTIONS.customerErpCreated, actorAccountId: null, detail: { registrationId: claimed.registrationId, outboxId: claimed.outboxId, erpCustomerCode: erpCode, attempts: claimed.attemptCount } },
        tx,
      );
    });
  }

  async fail(input: CustomerFailureRecord): Promise<void> {
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
          ...(input.erpCode === undefined ? {} : { erpReference: String(input.erpCode) }),
          ...(input.consumesAttempt ? {} : { attemptCount: sql`greatest(${integrationOutbox.attemptCount} - 1, 0)` }),
          updatedAt: at,
        })
        .where(eq(integrationOutbox.id, claimed.outboxId));
      if (input.kind === 'reject') {
        await tx
          .update(customerRegistration)
          .set({ status: 'rejected', rejectionCode: input.errorCode, updatedAt: at })
          .where(eq(customerRegistration.id, claimed.registrationId));
        await this.audit.record(
          { action: AUDIT_ACTIONS.customerErpRejected, actorAccountId: null, detail: { registrationId: claimed.registrationId, outboxId: claimed.outboxId, errorClass: input.errorClass, errorCode: input.errorCode } },
          tx,
        );
      } else if (input.kind === 'park') {
        await tx
          .update(customerRegistration)
          .set({ status: 'unknown', updatedAt: at })
          .where(eq(customerRegistration.id, claimed.registrationId));
        await this.audit.record(
          { action: AUDIT_ACTIONS.customerErpUnknown, actorAccountId: null, detail: { registrationId: claimed.registrationId, outboxId: claimed.outboxId, errorClass: input.errorClass, errorCode: input.errorCode, parked: true } },
          tx,
        );
      }
    });
  }
}
