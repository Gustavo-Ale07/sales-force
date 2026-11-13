import { customerRegistration, customerRegistrationRefusal, integrationOutbox, type Database } from '@salesforce/db';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Clock } from '../platform/tokens.js';

/**
 * Retention of the personal data inside customer commands (D-AR, M-5).
 *
 * Policy: a `customer.upsert` outbox row carries the whole request (CPF/CNPJ, e-mail, phone, notes, addresses). Once the
 * command is TERMINAL (`confirmed`: the ERP holds the customer; `rejected`: refused for good) the payload has no
 * operational use, so 30 days after its last change the payload is replaced by a marker. The row itself, its origin key,
 * ERP reference, state and timestamps stay: they are the business record of the delivery (SNK-4) and the origin key keeps
 * blocking a repeat.
 *
 * Never touched: rows that can still be delivered or looked at (`pending`, `processing`, `unknown`/parked, `dry_run`) and
 * any other aggregate or operation (orders). "Older than 30 days" is strict: exactly 30 days is kept.
 * Idempotent: purged rows no longer match and `updated_at` is not bumped.
 * (The outbox has no "cancelled" status; confirmed and rejected are its terminal states.)
 */
export const CUSTOMER_PAYLOAD_RETENTION_DAYS = 30;
export const PURGED_PAYLOAD = { purged: true } as const;
/** Refusals only feed the one-hour creation limit; a day is a wide margin. */
export const CUSTOMER_REFUSAL_RETENTION_HOURS = 24;

const TERMINAL_STATUSES = ['confirmed', 'rejected'];

export interface CustomerPayloadRetentionDeps {
  readonly database: Database;
  readonly now: Clock;
}

/**
 * Owner ruling 2026-11-13, on top of the payload clearing above: at the same 30 days the stored ERP error text
 * (`last_error_message`, which can echo the customer's data) is cleared too, and a REJECTED registration row is deleted.
 * A confirmed registration keeps `tax_id` and `name` for good (the duplicate-check key). The outbox row of a deleted
 * registration stays: it holds the origin key, so the spent request id can never be delivered twice (SNK-4).
 * A rejected registration whose outbox row can still be delivered (reprocessed by an operator) is never deleted.
 */
export class CustomerPayloadRetention {
  constructor(private readonly deps: CustomerPayloadRetentionDeps) {}

  /** Clears the outbox personal data, then deletes old rejected registrations. Returns how many outbox rows were cleared. */
  async purge(retentionDays = CUSTOMER_PAYLOAD_RETENTION_DAYS): Promise<number> {
    const cleared = await this.clearOutbox(retentionDays);
    await this.deleteRejectedRegistrations(retentionDays);
    return cleared;
  }

  private cutoff(retentionDays: number): Date {
    return new Date(this.deps.now().getTime() - retentionDays * 24 * 3600_000);
  }

  private async clearOutbox(retentionDays: number): Promise<number> {
    const cleared = await this.deps.database
      .update(integrationOutbox)
      .set({ payload: PURGED_PAYLOAD, lastErrorMessage: null })
      .where(
        and(
          eq(integrationOutbox.aggregateType, 'customer_registration'),
          eq(integrationOutbox.operation, 'customer.upsert'),
          inArray(integrationOutbox.status, TERMINAL_STATUSES),
          lt(integrationOutbox.updatedAt, this.cutoff(retentionDays)),
          sql`((${integrationOutbox.payload} ->> 'purged') is distinct from 'true' or ${integrationOutbox.lastErrorMessage} is not null)`,
        ),
      )
      .returning({ id: integrationOutbox.id });
    return cleared.length;
  }

  /** Returns how many registrations were deleted. */
  async deleteRejectedRegistrations(retentionDays = CUSTOMER_PAYLOAD_RETENTION_DAYS): Promise<number> {
    const deleted = await this.deps.database
      .delete(customerRegistration)
      .where(
        and(
          eq(customerRegistration.status, 'rejected'),
          lt(customerRegistration.updatedAt, this.cutoff(retentionDays)),
          sql`not exists (
            select 1 from ${integrationOutbox}
            where ${integrationOutbox.aggregateType} = 'customer_registration'
              and ${integrationOutbox.aggregateId} = ${customerRegistration.id}
              and ${integrationOutbox.status} not in ('confirmed', 'rejected')
          )`,
        ),
      )
      .returning({ id: customerRegistration.id });
    return deleted.length;
  }
}

/** Daily purge of refused duplicate attempts (account, instant, reason; no document) older than 24 hours. */
export class CustomerRefusalRetention {
  constructor(private readonly deps: CustomerPayloadRetentionDeps) {}

  /** Returns how many refusals were deleted. */
  async purge(retentionHours = CUSTOMER_REFUSAL_RETENTION_HOURS): Promise<number> {
    const cutoff = new Date(this.deps.now().getTime() - retentionHours * 3600_000);
    const deleted = await this.deps.database
      .delete(customerRegistrationRefusal)
      .where(lt(customerRegistrationRefusal.createdAt, cutoff))
      .returning({ id: customerRegistrationRefusal.id });
    return deleted.length;
  }
}
