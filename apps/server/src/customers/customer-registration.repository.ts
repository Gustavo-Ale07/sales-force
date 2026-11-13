import { Inject, Injectable } from '@nestjs/common';
import { customerRegistration, customerRegistrationRefusal, erpCustomer, erpSeller, integrationOutbox, type Database } from '@salesforce/db';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { isBlockedRaw } from '../mirror/mirror.repository.js';
import type { Executor } from '../orders/orders.repository.js';
import { DATABASE } from '../platform/tokens.js';

export type CustomerRegistrationRow = typeof customerRegistration.$inferSelect;

/** The holder of a document as stored; what may be shown of it is the service's decision (I-1). */
export type DocumentHolder =
  | {
      readonly source: 'mirror';
      readonly code: number;
      readonly name: string;
      readonly sellerCode: number | null;
      /** Active, not deleted and not blocked: only such a customer can be "in someone's portfolio". */
      readonly usable: boolean;
      /** Why it is not usable (all false when it is). Shown, as a situation only, to a scope that reaches every seller. */
      readonly inactive: boolean;
      readonly blocked: boolean;
      readonly deleted: boolean;
    }
  | { readonly source: 'registration'; readonly code: number | null; readonly name: string; readonly sellerCode: number | null };
export type NewCustomerRegistration = typeof customerRegistration.$inferInsert;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export const CUSTOMER_UPSERT_AGGREGATE = 'customer_registration';
export const CUSTOMER_UPSERT_OPERATION = 'customer.upsert';

/** First key of the two-integer advisory lock space of customer creators (`SFCR`). */
const REGISTRATION_LOCK_NAMESPACE = 0x53464352;
/** Second namespace (`SFCA`): one lock per account, taken before the document lock (fixed order, no deadlock). */
const ACCOUNT_LOCK_NAMESPACE = 0x53464341;

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

  /** Serializes the creators of one account, so the hourly count and the record that raises it are atomic (security review). */
  async lockAccount(accountId: string, tx: Executor): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(${ACCOUNT_LOCK_NAMESPACE}::int, hashtext(${accountId}))`);
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

  /**
   * Attempts of one account since `since`: creations started plus attempts refused before anything was recorded (I-1: a
   * refused duplicate counts, so the limit cannot be bypassed to probe documents). Serves the per-account hourly limit
   * (indexes `customer_registration_account_created_idx` and `customer_registration_refusal_account_created_idx`).
   */
  async countSince(accountId: string, since: Date, db: Executor = this.db): Promise<number> {
    const [created] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(customerRegistration)
      .where(and(eq(customerRegistration.createdByAccountId, accountId), gte(customerRegistration.createdAt, since)));
    const [refused] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(customerRegistrationRefusal)
      .where(and(eq(customerRegistrationRefusal.accountId, accountId), gte(customerRegistrationRefusal.createdAt, since)));
    return (created?.n ?? 0) + (refused?.n ?? 0);
  }

  /** Records a refused attempt: account, instant and reason code only (no document, no name, no hash). */
  async recordRefusal(input: { readonly id: string; readonly accountId: string; readonly reason: 'document_already_registered'; readonly at: Date }, tx: Executor): Promise<void> {
    await tx.insert(customerRegistrationRefusal).values({ id: input.id, accountId: input.accountId, reason: input.reason, createdAt: input.at });
  }

  /** The document already exists in the ERP mirror (any seller, any state: duplicates are decided globally). */
  async activeSellerExists(code: number, db: Executor = this.db): Promise<boolean> {
    const rows = await db
      .select({ code: erpSeller.code })
      .from(erpSeller)
      .where(and(eq(erpSeller.code, code), eq(erpSeller.active, true), isNull(erpSeller.deletedAt)))
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Who holds the document: the ERP mirror first (any seller, any state: duplicates are decided globally), then a
   * registration still in flight or already confirmed (index `customer_registration_tax_id_open_idx`). The caller decides
   * how much of it the asker may be told.
   */
  async findDocumentHolder(taxId: string, db: Executor = this.db): Promise<DocumentHolder | null> {
    const [customer] = await db
      .select({
        code: erpCustomer.code,
        name: erpCustomer.name,
        sellerCode: erpCustomer.sellerCode,
        active: erpCustomer.active,
        blockedRaw: erpCustomer.blockedRaw,
        deletedAt: erpCustomer.deletedAt,
      })
      .from(erpCustomer)
      .where(sql`regexp_replace(${erpCustomer.taxId}, '[^0-9]', '', 'g') = ${taxId}`)
      .orderBy(sql`(${erpCustomer.deletedAt} is null and ${erpCustomer.active}) desc`, erpCustomer.code)
      .limit(1);
    if (customer !== undefined) {
      const inactive = !customer.active;
      const blocked = isBlockedRaw(customer.blockedRaw);
      const deleted = customer.deletedAt !== null;
      return {
        source: 'mirror',
        code: customer.code,
        name: customer.name,
        sellerCode: customer.sellerCode,
        usable: !inactive && !blocked && !deleted,
        inactive,
        blocked,
        deleted,
      };
    }
    const [open] = await db
      .select({ name: customerRegistration.name, sellerCode: customerRegistration.sellerCode, erpCustomerCode: customerRegistration.erpCustomerCode })
      .from(customerRegistration)
      .where(and(eq(customerRegistration.taxId, taxId), sql`${customerRegistration.status} in ('pending', 'unknown', 'confirmed')`))
      .limit(1);
    return open === undefined ? null : { source: 'registration', code: open.erpCustomerCode, name: open.name, sellerCode: open.sellerCode };
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
