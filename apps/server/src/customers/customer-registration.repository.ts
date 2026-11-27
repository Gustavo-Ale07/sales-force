import { Inject, Injectable } from '@nestjs/common';
import {
  customerRegistration,
  customerRegistrationRefusal,
  erpCity,
  erpCustomer,
  forceConfig,
  erpPriceTable,
  erpNeighborhood,
  erpSeller,
  erpStreet,
  integrationOutbox,
  type Database,
} from '@salesforce/db';
import { resolveForceConfig } from '@salesforce/domain';
import { and, desc, eq, gte, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { RegistrationOutboxFacts } from './customer-registration-view.js';
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
export interface RegistrationWithOutbox {
  readonly registration: CustomerRegistrationRow;
  readonly outbox: RegistrationOutboxFacts | null;
}

function visibleTo(accountId: string, sellerCodes: readonly number[] | null): SQL | undefined {
  if (sellerCodes === null) return undefined;
  return or(eq(customerRegistration.createdByAccountId, accountId), sellerCodes.length === 0 ? undefined : inArray(customerRegistration.sellerCode, [...sellerCodes]));
}

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
  /** Whether a live mirrored city exists (the registration validates the chosen city against the ERP registry, P-08). */
  async cityExists(code: number, db: Executor = this.db): Promise<boolean> {
    const rows = await db.select({ code: erpCity.code }).from(erpCity).where(and(eq(erpCity.code, code), isNull(erpCity.deletedAt))).limit(1);
    return rows.length > 0;
  }

  async neighborhoodExists(code: number, db: Executor = this.db): Promise<boolean> {
    const rows = await db
      .select({ code: erpNeighborhood.code })
      .from(erpNeighborhood)
      .where(and(eq(erpNeighborhood.code, code), isNull(erpNeighborhood.deletedAt)))
      .limit(1);
    return rows.length > 0;
  }

  async streetExists(code: number, db: Executor = this.db): Promise<boolean> {
    const rows = await db.select({ code: erpStreet.code }).from(erpStreet).where(and(eq(erpStreet.code, code), isNull(erpStreet.deletedAt))).limit(1);
    return rows.length > 0;
  }

  /** Live mirrored neighborhoods/streets, to match free text by name (loaded only when a request carries a name to resolve). */
  async neighborhoodRegistry(db: Executor = this.db): Promise<{ code: number; name: string }[]> {
    return db.select({ code: erpNeighborhood.code, name: erpNeighborhood.name }).from(erpNeighborhood).where(isNull(erpNeighborhood.deletedAt));
  }

  async streetRegistry(db: Executor = this.db): Promise<{ code: number; name: string; kind: string | null }[]> {
    return db.select({ code: erpStreet.code, name: erpStreet.name, kind: erpStreet.kind }).from(erpStreet).where(isNull(erpStreet.deletedAt));
  }

  /** P-08: the table is an active, non-deleted row of the price-table mirror (which holds only tables with mobility). */
  async activePriceTableExists(code: number, db: Executor = this.db): Promise<boolean> {
    if (!Number.isInteger(code) || code < 0 || code > 2_147_483_647) return false;
    const rows = await db
      .select({ code: erpPriceTable.code })
      .from(erpPriceTable)
      .where(and(eq(erpPriceTable.code, code), eq(erpPriceTable.active, true), isNull(erpPriceTable.deletedAt)))
      .limit(1);
    return rows.length > 0;
  }

  /** The installation default price table: the Force own configuration (owner ruling 2026-11-27), with the domain fallback. */
  async defaultPriceTableCode(db: Executor = this.db): Promise<number> {
    const [row] = await db
      .select({ maxDaysWithoutSync: forceConfig.maxDaysWithoutSync, defaultPriceTableCode: forceConfig.defaultPriceTableCode })
      .from(forceConfig)
      .where(eq(forceConfig.id, 1));
    return resolveForceConfig(row ?? null).defaultPriceTableCode;
  }

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

  /** A registration plus the facts of its outbox command that explain its state (error text, parked or retrying). */
  async findViewById(id: string, db: Executor = this.db): Promise<RegistrationWithOutbox | null> {
    const rows = await this.selectWithOutbox(db, eq(customerRegistration.id, id), 1);
    return rows[0] ?? null;
  }

  /** Registrations the reader may see: every one for a scope that reaches all sellers, otherwise the reader's own or those of the scope's sellers. */
  async listVisible(
    input: { readonly accountId: string; readonly sellerCodes: readonly number[] | null; readonly statuses: readonly string[] | null; readonly limit: number },
    db: Executor = this.db,
  ): Promise<RegistrationWithOutbox[]> {
    return this.selectWithOutbox(
      db,
      and(visibleTo(input.accountId, input.sellerCodes), input.statuses === null ? undefined : inArray(customerRegistration.status, [...input.statuses])),
      input.limit,
    );
  }

  /** A registration the reader may see whose ERP customer code is `code` (a customer not yet in the mirror). */
  async existsVisibleWithCode(input: { readonly code: number; readonly accountId: string; readonly sellerCodes: readonly number[] | null }, db: Executor = this.db): Promise<boolean> {
    const [row] = await db
      .select({ id: customerRegistration.id })
      .from(customerRegistration)
      .where(and(eq(customerRegistration.erpCustomerCode, input.code), visibleTo(input.accountId, input.sellerCodes)))
      .limit(1);
    return row !== undefined;
  }

  /** Legacy: a rejected registration that an old build already replaced by a correction no longer needs attention. */
  async hasCorrection(registrationId: string, db: Executor = this.db): Promise<boolean> {
    const [row] = await db.select({ id: customerRegistration.id }).from(customerRegistration).where(eq(customerRegistration.correctsRegistrationId, registrationId)).limit(1);
    return row !== undefined;
  }

  private async selectWithOutbox(db: Executor, where: SQL | undefined, limit: number): Promise<RegistrationWithOutbox[]> {
    const rows = await db
      .select({
        registration: customerRegistration,
        outboxStatus: integrationOutbox.status,
        nextAttemptAt: integrationOutbox.nextAttemptAt,
        lastErrorMessage: integrationOutbox.lastErrorMessage,
      })
      .from(customerRegistration)
      .leftJoin(integrationOutbox, and(eq(integrationOutbox.aggregateType, CUSTOMER_UPSERT_AGGREGATE), eq(integrationOutbox.aggregateId, customerRegistration.id)))
      .where(where)
      .orderBy(desc(customerRegistration.createdAt), desc(customerRegistration.id))
      .limit(limit);
    return rows.map((row) => ({
      registration: row.registration,
      outbox: row.outboxStatus === null ? null : { status: row.outboxStatus, nextAttemptAt: row.nextAttemptAt, lastErrorMessage: row.lastErrorMessage },
    }));
  }

  /**
   * CUST-RT: puts the seller on a registration that is not delivered yet and queues its outbox command again (never an ERP call).
   * `false` = nothing changed (already confirmed, or the worker has it right now).
   */
  async requeueWithSeller(input: { readonly id: string; readonly sellerCode: number; readonly at: Date }, tx: Executor): Promise<boolean> {
    const [outbox] = await tx
      .update(integrationOutbox)
      .set({
        status: 'pending',
        nextAttemptAt: input.at,
        attemptCount: 0,
        lastStep: null,
        lastErrorClass: null,
        lastErrorMessage: null,
        payload: sql`${integrationOutbox.payload} || jsonb_build_object('sellerCode', ${input.sellerCode}::int)`,
        updatedAt: input.at,
      })
      .where(
        and(
          eq(integrationOutbox.aggregateType, CUSTOMER_UPSERT_AGGREGATE),
          eq(integrationOutbox.aggregateId, input.id),
          inArray(integrationOutbox.status, ['pending', 'rejected', 'unknown']),
          // a final refusal (repeated document) is never re-sent by choosing a seller
          sql`not exists (select 1 from ${customerRegistration} cr where cr.id = ${input.id} and cr.rejection_code = 'partner_document_duplicate')`,
        ),
      )
      .returning({ id: integrationOutbox.id });
    if (outbox === undefined) return false;
    await tx
      .update(customerRegistration)
      .set({ status: 'pending', rejectionCode: null, sellerCode: input.sellerCode, updatedAt: input.at })
      .where(eq(customerRegistration.id, input.id));
    return true;
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
