import { Inject, Injectable } from '@nestjs/common';
import { erpCustomer, salesOrder, salesOrderItem, type Database } from '@salesforce/db';
import type { CustomerScope, OrderItem } from '@salesforce/domain';
import { and, asc, desc, eq, ne, or, sql, type SQL } from 'drizzle-orm';
import { containsText, digitsOf, eqInt, inInts, offsetOf } from '../platform/sql.js';
import { DATABASE } from '../platform/tokens.js';

export type OrderRow = typeof salesOrder.$inferSelect;
export type OrderItemRow = typeof salesOrderItem.$inferSelect;
export type NewOrder = typeof salesOrder.$inferInsert;

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** The database or an open transaction: writes of one business operation share a transaction. */
export type Executor = Database | Transaction;

export interface OrderListFilter {
  readonly scope: CustomerScope;
  readonly search?: string | undefined;
  readonly status?: string | undefined;
  readonly customerCode?: number | undefined;
  readonly sort: 'updatedAt' | '-updatedAt' | 'draftNumber' | '-draftNumber';
}

export interface OrderListRow {
  readonly order: OrderRow;
  readonly customerName: string | null;
  readonly itemCount: number;
  readonly unpricedCount: number;
}

export interface OrderCounts {
  readonly drafts: number;
  readonly draftsEstimatedTotal: string;
  readonly cancelled: number;
}

/** Order visibility follows the seller recorded on the order at draft time (P-21). */
function scopeCondition(scope: CustomerScope): SQL | undefined {
  return scope.kind === 'all' ? undefined : inInts(salesOrder.sellerCode, scope.sellerCodes);
}

@Injectable()
export class OrdersRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  async findByClientRequestId(clientRequestId: string, executor: Executor = this.db): Promise<OrderRow | null> {
    const [row] = await executor.select().from(salesOrder).where(eq(salesOrder.clientRequestId, clientRequestId));
    return row ?? null;
  }

  async findById(id: string, executor: Executor = this.db, lock = false): Promise<OrderRow | null> {
    const query = executor.select().from(salesOrder).where(eq(salesOrder.id, id));
    const [row] = await (lock ? query.for('update') : query);
    return row ?? null;
  }

  async itemsOf(orderId: string, executor: Executor = this.db): Promise<OrderItemRow[]> {
    return executor.select().from(salesOrderItem).where(eq(salesOrderItem.orderId, orderId)).orderBy(asc(salesOrderItem.lineNo));
  }

  /**
   * The customer's most recent NON-cancelled order recorded in Sales Force ("Repetir último pedido",
   * Phase C) — never Sankhya/ERP order history, which is not mirrored here. `draftNumber` is a global
   * sequential identity, so the highest value for the customer is the most recently created order.
   * Scoped like every other order read (P-21).
   */
  async findLatestForCustomer(scope: CustomerScope, customerCode: number, executor: Executor = this.db): Promise<OrderRow | null> {
    const [row] = await executor
      .select()
      .from(salesOrder)
      .where(and(scopeCondition(scope), eqInt(salesOrder.customerCode, customerCode), ne(salesOrder.status, 'cancelled')))
      .orderBy(desc(salesOrder.draftNumber))
      .limit(1);
    return row ?? null;
  }

  /** Inserts the order unless the client request id already exists (`null` = a concurrent create won). */
  async insertOrder(values: NewOrder, executor: Executor): Promise<OrderRow | null> {
    const [row] = await executor
      .insert(salesOrder)
      .values(values)
      .onConflictDoNothing({ target: salesOrder.clientRequestId })
      .returning();
    return row ?? null;
  }

  async insertItems(
    orderId: string,
    items: readonly OrderItem[],
    idFor: () => string,
    executor: Executor,
  ): Promise<void> {
    if (items.length === 0) return;
    await executor.insert(salesOrderItem).values(
      items.map((item) => ({
        id: idFor(),
        orderId,
        lineNo: item.lineNo,
        productCode: item.productCode,
        productDescription: item.productDescription,
        unit: item.unit === '' ? null : item.unit,
        quantity: item.quantity,
        unitListPrice: item.unitListPrice,
        priceState: item.priceState,
        priceTableCode: item.priceTableCode,
        priceVersionId: item.priceVersionId,
        estimatedLineTotal: item.estimatedLineTotal,
      })),
    );
  }

  async deleteItems(orderId: string, executor: Executor): Promise<void> {
    await executor.delete(salesOrderItem).where(eq(salesOrderItem.orderId, orderId));
  }

  async updateOrder(
    id: string,
    values: Partial<Pick<NewOrder, 'customerCode' | 'sellerCode' | 'status' | 'negotiationTypeCode' | 'notes' | 'estimatedTotal' | 'version' | 'configVersionId' | 'updatedAt'>>,
    executor: Executor,
  ): Promise<OrderRow> {
    const [row] = await executor.update(salesOrder).set(values).where(eq(salesOrder.id, id)).returning();
    if (row === undefined) throw new Error('Order vanished during an update inside its own transaction');
    return row;
  }

  async list(filter: OrderListFilter, page: { page: number; pageSize: number }): Promise<{ rows: OrderListRow[]; total: number }> {
    const digits = filter.search === undefined ? null : digitsOf(filter.search);
    const number = digits === null ? null : Number(digits);
    const searchCondition =
      filter.search === undefined
        ? undefined
        : or(
            containsText(erpCustomer.name, filter.search),
            containsText(erpCustomer.tradeName, filter.search),
            number === null ? undefined : eqInt(salesOrder.draftNumber, number),
            number === null ? undefined : eqInt(salesOrder.customerCode, number),
            number === null || !Number.isSafeInteger(number) ? undefined : sql`${salesOrder.erpNumber} = ${number}`,
          );
    const where = and(
      scopeCondition(filter.scope),
      filter.status === undefined ? undefined : eq(salesOrder.status, filter.status),
      filter.customerCode === undefined ? undefined : eqInt(salesOrder.customerCode, filter.customerCode),
      searchCondition,
    );

    const direction = filter.sort.startsWith('-') ? desc : asc;
    const order =
      filter.sort === 'updatedAt' || filter.sort === '-updatedAt'
        ? [direction(salesOrder.updatedAt), direction(salesOrder.draftNumber)]
        : [direction(salesOrder.draftNumber)];

    const [rows, totals] = await Promise.all([
      this.db
        .select({
          order: salesOrder,
          customerName: erpCustomer.name,
          itemCount: sql<number>`(select count(*)::int from ${salesOrderItem} where ${salesOrderItem.orderId} = ${salesOrder.id})`,
          unpricedCount: sql<number>`(select count(*)::int from ${salesOrderItem} where ${salesOrderItem.orderId} = ${salesOrder.id} and ${salesOrderItem.priceState} = 'none')`,
        })
        .from(salesOrder)
        .leftJoin(erpCustomer, eq(erpCustomer.code, salesOrder.customerCode))
        .where(where)
        .orderBy(...order)
        .limit(page.pageSize)
        .offset(offsetOf(page.page, page.pageSize)),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(salesOrder)
        .leftJoin(erpCustomer, eq(erpCustomer.code, salesOrder.customerCode))
        .where(where),
    ]);
    return { rows, total: totals[0]?.total ?? 0 };
  }

  async countByStatus(scope: CustomerScope): Promise<OrderCounts> {
    const [row] = await this.db
      .select({
        drafts: sql<number>`(count(*) filter (where ${salesOrder.status} = 'draft'))::int`,
        draftsEstimatedTotal: sql<string>`round(coalesce(sum(${salesOrder.estimatedTotal}) filter (where ${salesOrder.status} = 'draft'), 0), 2)::text`,
        cancelled: sql<number>`(count(*) filter (where ${salesOrder.status} = 'cancelled'))::int`,
      })
      .from(salesOrder)
      .where(scopeCondition(scope));
    return {
      drafts: row?.drafts ?? 0,
      draftsEstimatedTotal: row?.draftsEstimatedTotal ?? '0.00',
      cancelled: row?.cancelled ?? 0,
    };
  }
}
