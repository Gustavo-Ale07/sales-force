import { integrationOutbox, type Database } from '@salesforce/db';
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

const TERMINAL_STATUSES = ['confirmed', 'rejected'];

export interface CustomerPayloadRetentionDeps {
  readonly database: Database;
  readonly now: Clock;
}

export class CustomerPayloadRetention {
  constructor(private readonly deps: CustomerPayloadRetentionDeps) {}

  /** Returns how many rows were cleared. */
  async purge(retentionDays = CUSTOMER_PAYLOAD_RETENTION_DAYS): Promise<number> {
    const cutoff = new Date(this.deps.now().getTime() - retentionDays * 24 * 3600_000);
    const cleared = await this.deps.database
      .update(integrationOutbox)
      .set({ payload: PURGED_PAYLOAD })
      .where(
        and(
          eq(integrationOutbox.aggregateType, 'customer_registration'),
          eq(integrationOutbox.operation, 'customer.upsert'),
          inArray(integrationOutbox.status, TERMINAL_STATUSES),
          lt(integrationOutbox.updatedAt, cutoff),
          sql`(${integrationOutbox.payload} ->> 'purged') is distinct from 'true'`,
        ),
      )
      .returning({ id: integrationOutbox.id });
    return cleared.length;
  }
}
