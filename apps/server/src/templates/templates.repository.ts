import { Inject, Injectable } from '@nestjs/common';
import {
  customerOrderTemplate,
  customerOrderTemplateItem,
  erpCustomer,
  type Database,
} from '@salesforce/db';
import type { CustomerScope, TemplateItem } from '@salesforce/domain';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Executor } from '../orders/orders.repository.js';
import { fitsPgInt, inSellerCodes } from '../platform/sql.js';
import { DATABASE } from '../platform/tokens.js';

export type TemplateRow = typeof customerOrderTemplate.$inferSelect;
export type TemplateItemRow = typeof customerOrderTemplateItem.$inferSelect;
export type NewTemplate = typeof customerOrderTemplate.$inferInsert;
export interface TemplateListRow {
  readonly template: TemplateRow;
  readonly itemCount: number;
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** First key of the two-integer advisory lock space of the template writers (`SFTP`). */
const TEMPLATE_LOCK_NAMESPACE = 0x53465450;

/**
 * Storage of recurring order templates. A template is visible only through its live customer inside the
 * caller's seller scope (P-21): the scope is part of every read here, so an out-of-scope template is
 * indistinguishable from a missing or deleted one. Nothing here stores or selects a price.
 */
@Injectable()
export class TemplatesRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  private customerScopeCondition(scope: CustomerScope) {
    return scope.kind === 'all' ? undefined : inSellerCodes(erpCustomer.sellerCode, scope.sellerCodes);
  }

  /* ---------- locks ---------- */

  /**
   * Serializes the writers that change the set of live templates of one customer (create, replace, delete):
   * the 50-template limit and the name uniqueness are then decided on a stable set. Held until the transaction
   * ends. Always taken before any row lock, so writers cannot deadlock on each other.
   */
  async lockCustomerTemplates(customerCode: number, tx: Executor): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(${TEMPLATE_LOCK_NAMESPACE}::int, ${customerCode}::int)`);
  }

  /**
   * FOR SHARE on the live customer row, only when it lies inside the scope: a customer reassigned to another
   * seller (or removed) after the caller's first read is no longer reachable, and the row cannot change under
   * the transaction. `false` = out of scope or gone.
   */
  async lockCustomerInScope(scope: CustomerScope, customerCode: number, tx: Executor): Promise<boolean> {
    if (!fitsPgInt(customerCode)) return false;
    const rows = await tx
      .select({ code: erpCustomer.code })
      .from(erpCustomer)
      .where(
        and(
          eq(erpCustomer.code, customerCode),
          isNull(erpCustomer.deletedAt),
          eq(erpCustomer.isCustomer, true),
          this.customerScopeCondition(scope),
        ),
      )
      .for('share');
    return rows.length > 0;
  }

  /** FOR UPDATE on a live template row (`null` = missing or soft-deleted). */
  async lockTemplate(id: string, tx: Executor): Promise<TemplateRow | null> {
    const [row] = await tx
      .select()
      .from(customerOrderTemplate)
      .where(and(eq(customerOrderTemplate.id, id), isNull(customerOrderTemplate.deletedAt)))
      .for('update');
    return row ?? null;
  }

  /* ---------- reads ---------- */

  /** A live template whose customer is live and inside the scope. */
  async findVisible(scope: CustomerScope, id: string, executor: Executor = this.db): Promise<TemplateRow | null> {
    const [row] = await executor
      .select({ template: customerOrderTemplate })
      .from(customerOrderTemplate)
      .innerJoin(erpCustomer, eq(erpCustomer.code, customerOrderTemplate.customerCode))
      .where(
        and(
          eq(customerOrderTemplate.id, id),
          isNull(customerOrderTemplate.deletedAt),
          isNull(erpCustomer.deletedAt),
          eq(erpCustomer.isCustomer, true),
          this.customerScopeCondition(scope),
        ),
      );
    return row?.template ?? null;
  }

  /** The creation of an account with this request id, deleted or not (a replay never re-creates). */
  async findByRequest(accountId: string, clientRequestId: string, executor: Executor = this.db): Promise<TemplateRow | null> {
    const [row] = await executor
      .select()
      .from(customerOrderTemplate)
      .where(
        and(
          eq(customerOrderTemplate.createdByAccountId, accountId),
          eq(customerOrderTemplate.clientRequestId, clientRequestId),
        ),
      );
    return row ?? null;
  }

  async listForCustomer(customerCode: number): Promise<TemplateListRow[]> {
    return this.db
      .select({
        template: customerOrderTemplate,
        itemCount: sql<number>`(select count(*)::int from ${customerOrderTemplateItem} where ${customerOrderTemplateItem.templateId} = ${customerOrderTemplate.id})`,
      })
      .from(customerOrderTemplate)
      .where(and(eq(customerOrderTemplate.customerCode, customerCode), isNull(customerOrderTemplate.deletedAt)))
      .orderBy(asc(sql`lower(${customerOrderTemplate.name})`), asc(customerOrderTemplate.id));
  }

  async itemsOf(templateId: string, executor: Executor = this.db): Promise<TemplateItemRow[]> {
    return executor
      .select()
      .from(customerOrderTemplateItem)
      .where(eq(customerOrderTemplateItem.templateId, templateId))
      .orderBy(asc(customerOrderTemplateItem.lineNo));
  }

  async countLive(customerCode: number, tx: Executor): Promise<number> {
    const [row] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(customerOrderTemplate)
      .where(and(eq(customerOrderTemplate.customerCode, customerCode), isNull(customerOrderTemplate.deletedAt)));
    return row?.total ?? 0;
  }

  /** A live template of the customer already has this name (case-insensitive), other than `exceptId`. */
  async nameTaken(customerCode: number, name: string, exceptId: string | null, tx: Executor): Promise<boolean> {
    const rows = await tx
      .select({ id: customerOrderTemplate.id })
      .from(customerOrderTemplate)
      .where(
        and(
          eq(customerOrderTemplate.customerCode, customerCode),
          isNull(customerOrderTemplate.deletedAt),
          sql`lower(${customerOrderTemplate.name}) = lower(${name})`,
          exceptId === null ? undefined : ne(customerOrderTemplate.id, exceptId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /* ---------- writes ---------- */

  /** Inserts the template unless (account, request id) already exists (`null` = a concurrent create won). */
  async insertTemplate(values: NewTemplate, tx: Executor): Promise<TemplateRow | null> {
    const [row] = await tx
      .insert(customerOrderTemplate)
      .values(values)
      .onConflictDoNothing({
        target: [customerOrderTemplate.createdByAccountId, customerOrderTemplate.clientRequestId],
      })
      .returning();
    return row ?? null;
  }

  async insertItems(templateId: string, items: readonly TemplateItem[], tx: Executor): Promise<void> {
    if (items.length === 0) return;
    await tx.insert(customerOrderTemplateItem).values(
      items.map((item, index) => ({
        templateId,
        lineNo: index + 1,
        productCode: item.productCode,
        quantity: item.quantity,
      })),
    );
  }

  async deleteItems(templateId: string, tx: Executor): Promise<void> {
    await tx.delete(customerOrderTemplateItem).where(eq(customerOrderTemplateItem.templateId, templateId));
  }

  async updateTemplate(
    id: string,
    values: Partial<Pick<NewTemplate, 'name' | 'version' | 'updatedAt' | 'deletedAt'>>,
    tx: Executor,
  ): Promise<TemplateRow> {
    const [row] = await tx.update(customerOrderTemplate).set(values).where(eq(customerOrderTemplate.id, id)).returning();
    if (row === undefined) throw new Error('Template vanished during an update inside its own transaction');
    return row;
  }
}
