import { Inject, Injectable } from '@nestjs/common';
import { erpCustomer, salesOrder, salesOrderItem, type Database } from '@salesforce/db';
import type { CustomerScope, OrderItem } from '@salesforce/domain';
import { and, asc, desc, eq, ne, or, sql, type SQL } from 'drizzle-orm';
import { containsText, digitsOf, eqInt, fitsPgInt, inInts, offsetOf } from '../platform/sql.js';
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
  /** Inclusive calendar dates (`YYYY-MM-DD`) in {@link BUSINESS_TIME_ZONE}, applied to `dateField`. */
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly dateField?: 'createdAt' | 'updatedAt' | undefined;
  /** Orders with a line for these products: at least one (`any`, default) or every one (`all`). */
  readonly productCodes?: readonly number[] | undefined;
  readonly productMatch?: 'any' | 'all' | undefined;
  readonly sort: 'updatedAt' | '-updatedAt' | 'draftNumber' | '-draftNumber';
}

/** Time zone the period filter is read in (decisions.md: business calculations in America/Sao_Paulo). */
export const BUSINESS_TIME_ZONE = 'America/Sao_Paulo';

/** Lines shown as a glance in the list. */
const ITEM_PREVIEW_SIZE = 3;

export interface OrderListRow {
  readonly order: OrderRow;
  readonly customerName: string | null;
  readonly itemCount: number;
  /** Descriptions of the first lines (matching lines first when filtered by product). */
  readonly itemPreview: readonly string[];
  readonly unpricedCount: number;
}

export interface OrderCounts {
  readonly drafts: number;
  readonly draftsEstimatedTotal: string;
  readonly cancelled: number;
}

/** Order visibility follows the seller recorded on the order at draft time (P-21). */
/**
 * Product filter on the order lines. `any`: at least one line is one of the products. `all`: every product has a
 * line (distinct products, so a repeated line never counts twice). A code that cannot exist in an `integer`
 * column matches nothing, so it makes an `all` filter empty and is ignored by `any`.
 */
function productCondition(codes: readonly number[] | undefined, match: 'any' | 'all' | undefined): SQL | undefined {
  if (codes === undefined || codes.length === 0) return undefined;
  const wanted = [...new Set(codes)];
  const usable = wanted.filter(fitsPgInt);
  if (usable.length === 0 || (match === 'all' && usable.length !== wanted.length)) return sql`false`;
  const lineOfProducts = sql`${salesOrderItem.orderId} = ${salesOrder.id} and ${inInts(salesOrderItem.productCode, usable)}`;
  return match === 'all'
    ? sql`(select count(distinct ${salesOrderItem.productCode}) from ${salesOrderItem} where ${lineOfProducts}) = ${usable.length}`
    : sql`exists (select 1 from ${salesOrderItem} where ${lineOfProducts})`;
}

/** `ORDER BY` prefix that puts the lines of the filtered products first in the list preview. */
function matchingLinesFirst(codes: readonly number[] | undefined): SQL {
  const usable = (codes ?? []).filter(fitsPgInt);
  return usable.length === 0 ? sql`` : sql`(${inInts(salesOrderItem.productCode, usable)}) desc, `;
}

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
    const dateColumn = filter.dateField === 'updatedAt' ? salesOrder.updatedAt : salesOrder.createdAt;
    const zone = sql.raw(`'${BUSINESS_TIME_ZONE}'`);
    const where = and(
      scopeCondition(filter.scope),
      filter.status === undefined ? undefined : eq(salesOrder.status, filter.status),
      filter.customerCode === undefined ? undefined : eqInt(salesOrder.customerCode, filter.customerCode),
      // The bounds are compared against the raw column so the date indexes stay usable.
      filter.from === undefined ? undefined : sql`${dateColumn} >= (${filter.from}::date)::timestamp at time zone ${zone}`,
      filter.to === undefined ? undefined : sql`${dateColumn} < (${filter.to}::date + 1)::timestamp at time zone ${zone}`,
      productCondition(filter.productCodes, filter.productMatch),
      searchCondition,
    );
    const previewFirst = matchingLinesFirst(filter.productCodes);

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
          itemPreview: sql<string[]>`array(select ${salesOrderItem.productDescription} from ${salesOrderItem} where ${salesOrderItem.orderId} = ${salesOrder.id} order by ${previewFirst}${salesOrderItem.lineNo} limit ${sql.raw(String(ITEM_PREVIEW_SIZE))})`,
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
