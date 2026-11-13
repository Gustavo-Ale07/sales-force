import { Inject, Injectable } from '@nestjs/common';
import { customerRegistration, erpCustomer, integrationOutbox, type Database } from '@salesforce/db';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Executor } from '../orders/orders.repository.js';
import { DATABASE } from '../platform/tokens.js';

export type CustomerRegistrationRow = typeof customerRegistration.$inferSelect;
export type NewCustomerRegistration = typeof customerRegistration.$inferInsert;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export const CUSTOMER_UPSERT_AGGREGATE = 'customer_registration';
export const CUSTOMER_UPSERT_OPERATION = 'customer.upsert';

/** First key of the two-integer advisory lock space of customer creators (`SFCR`). */
const REGISTRATION_LOCK_NAMESPACE = 0x53464352;

/**
 * Storage of customer-creation requests (D-AR). Writes the request row and its outbox command in one
 * transaction; the worker delivers the command and finalizes the row. Personal data never reaches logs.
 */
@Injectable()
export class CustomerRegistrationRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  /** Serializes creators of the same document, so two requests cannot both pass the duplicate check. */
  async lockDocument(taxId: string, tx: Executor): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(${REGISTRATION_LOCK_NAMESPACE}::int, hashtext(${taxId}))`);
  }

  async findByRequest(accountId: string, clientRequestId: string, db: Executor = this.db): Promise<CustomerRegistrationRow | null> {
    const [row] = await db
      .select()
      .from(customerRegistration)
      .where(and(eq(customerRegistration.createdByAccountId, accountId), eq(customerRegistration.clientRequestId, clientRequestId)))
      .limit(1);
    return row ?? null;
  }

  async findById(id: string, db: Executor = this.db): Promise<CustomerRegistrationRow | null> {
    const [row] = await db.select().from(customerRegistration).where(eq(customerRegistration.id, id)).limit(1);
    return row ?? null;
  }

  /** Serves the per-account hourly limit (index `customer_registration_account_created_idx`). */
  async countSince(accountId: string, since: Date, db: Executor = this.db): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(customerRegistration)
      .where(and(eq(customerRegistration.createdByAccountId, accountId), gte(customerRegistration.createdAt, since)));
    return row?.n ?? 0;
  }

  /** The document already exists in the ERP mirror (any seller, any state: duplicates are decided globally). */
  async mirrorHasDocument(taxId: string, db: Executor = this.db): Promise<boolean> {
    const rows = await db
      .select({ code: erpCustomer.code })
      .from(erpCustomer)
      .where(sql`regexp_replace(${erpCustomer.taxId}, '[^0-9]', '', 'g') = ${taxId}`)
      .limit(1);
    return rows.length > 0;
  }

  /** Another request for the same document is still in flight or already confirmed (index `customer_registration_tax_id_open_idx`). */
  async openRegistrationHasDocument(taxId: string, db: Executor = this.db): Promise<boolean> {
    const rows = await db
      .select({ id: customerRegistration.id })
      .from(customerRegistration)
      .where(and(eq(customerRegistration.taxId, taxId), sql`${customerRegistration.status} in ('pending', 'unknown', 'confirmed')`))
      .limit(1);
    return rows.length > 0;
  }

  async insert(row: NewCustomerRegistration, tx: Executor): Promise<CustomerRegistrationRow> {
    const [inserted] = await tx.insert(customerRegistration).values(row).returning();
    if (inserted === undefined) throw new Error('customer_registration insert returned no row');
    return inserted;
  }

  /** The command for the worker. `originId` is the Force origin key: the outbox never holds two rows for one customer (SNK-4). */
  async enqueueUpsert(
    input: { readonly id: string; readonly registrationId: string; readonly originKey: string; readonly payload: Record<string, unknown>; readonly at: Date },
    tx: Executor,
  ): Promise<void> {
    await tx.insert(integrationOutbox).values({
      id: input.id,
      aggregateType: CUSTOMER_UPSERT_AGGREGATE,
      aggregateId: input.registrationId,
      operation: CUSTOMER_UPSERT_OPERATION,
      payload: input.payload,
      originId: input.originKey,
      status: 'pending',
      nextAttemptAt: input.at,
      createdAt: input.at,
      updatedAt: input.at,
    });
  }
}
