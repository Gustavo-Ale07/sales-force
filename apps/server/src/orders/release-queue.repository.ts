import { Inject, Injectable } from '@nestjs/common';
import { erpCustomer, erpSeller, salesOrder, salesOrderErpStage, salesOrderReleasePending, type Database } from '@salesforce/db';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { offsetOf } from '../platform/sql.js';
import { DATABASE } from '../platform/tokens.js';

export interface ReleaseQueueRow {
  readonly nunota: number;
  readonly orderId: string;
  readonly draftNumber: number;
  readonly sector: string;
  readonly event: number;
  readonly cascadeSequence: number | null;
  readonly customerCode: number;
  readonly customerName: string | null;
  readonly sellerCode: number | null;
  readonly sellerName: string | null;
  readonly estimatedTotal: string;
  readonly topCode: number | null;
  readonly orderedAt: Date;
  readonly requestedAt: Date | null;
  readonly firstSeenAt: Date;
  readonly assignedUserCode: number | null;
  readonly checkedAt: Date;
}

export interface ReleaseQueueFilter {
  readonly sectors: readonly string[];
  readonly sellerCode?: number | undefined;
  readonly assignedUserCode?: number | undefined;
}

/** Read side of the release queue: the worker's mirror (`sales_order_release_pending`) joined to the order, its stage read and the mirrored customer/seller names. Never writes. */
@Injectable()
export class ReleaseQueueRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private where(filter: ReleaseQueueFilter): SQL | undefined {
    return and(
      inArray(salesOrderReleasePending.sector, [...filter.sectors]),
      eq(salesOrder.status, 'sent'),
      filter.sellerCode === undefined ? undefined : eq(salesOrder.sellerCode, filter.sellerCode),
      filter.assignedUserCode === undefined ? undefined : eq(salesOrderReleasePending.assignedUserCode, filter.assignedUserCode),
    );
  }

  /** Oldest waiting first: the Sankhya request time when known, else the order time; ties by note number. */
  async list(filter: ReleaseQueueFilter, page: { page: number; pageSize: number }): Promise<{ rows: ReleaseQueueRow[]; total: number }> {
    if (filter.sectors.length === 0) return { rows: [], total: 0 };
    const where = this.where(filter);
    const [rows, totals] = await Promise.all([
      this.db
        .select({
          nunota: salesOrderReleasePending.nunota,
          orderId: salesOrder.id,
          draftNumber: salesOrder.draftNumber,
          sector: salesOrderReleasePending.sector,
          event: salesOrderReleasePending.event,
          cascadeSequence: salesOrderReleasePending.cascadeSequence,
          customerCode: salesOrder.customerCode,
          customerName: erpCustomer.name,
          sellerCode: salesOrder.sellerCode,
          sellerName: erpSeller.name,
          estimatedTotal: salesOrder.estimatedTotal,
          topCode: salesOrder.topCode,
          orderedAt: salesOrder.createdAt,
          requestedAt: salesOrderReleasePending.requestedAt,
          firstSeenAt: salesOrderReleasePending.firstSeenAt,
          assignedUserCode: salesOrderReleasePending.assignedUserCode,
          checkedAt: salesOrderErpStage.checkedAt,
        })
        .from(salesOrderReleasePending)
        .innerJoin(salesOrder, eq(salesOrder.id, salesOrderReleasePending.orderId))
        .innerJoin(salesOrderErpStage, eq(salesOrderErpStage.orderId, salesOrder.id))
        .leftJoin(erpCustomer, eq(erpCustomer.code, salesOrder.customerCode))
        .leftJoin(erpSeller, eq(erpSeller.code, salesOrder.sellerCode))
        .where(where)
        .orderBy(
          asc(sql`coalesce(${salesOrderReleasePending.requestedAt}, ${salesOrder.createdAt})`),
          asc(salesOrderReleasePending.nunota),
          asc(salesOrderReleasePending.sector),
          asc(salesOrderReleasePending.event),
        )
        .limit(page.pageSize)
        .offset(offsetOf(page.page, page.pageSize)),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(salesOrderReleasePending)
        .innerJoin(salesOrder, eq(salesOrder.id, salesOrderReleasePending.orderId))
        .where(where),
    ]);
    return { rows, total: totals[0]?.total ?? 0 };
  }

  /** Orders (not lines) waiting per sector, the number of distinct orders over all the given sectors, and the freshest read among them. */
  async count(sectors: readonly string[]): Promise<{ perSector: Map<string, number>; total: number; lastCheckedAt: Date | null }> {
    const perSector = new Map<string, number>(sectors.map((sector) => [sector, 0]));
    if (sectors.length === 0) return { perSector, total: 0, lastCheckedAt: null };
    const where = this.where({ sectors });
    const [grouped, overall] = await Promise.all([
      this.db
        .select({ sector: salesOrderReleasePending.sector, n: sql<number>`count(distinct ${salesOrderReleasePending.orderId})::int` })
        .from(salesOrderReleasePending)
        .innerJoin(salesOrder, eq(salesOrder.id, salesOrderReleasePending.orderId))
        .where(where)
        .groupBy(salesOrderReleasePending.sector),
      this.db
        .select({
          total: sql<number>`count(distinct ${salesOrderReleasePending.orderId})::int`,
          lastCheckedAt: sql<Date | null>`max(${salesOrderErpStage.checkedAt})`,
        })
        .from(salesOrderReleasePending)
        .innerJoin(salesOrder, eq(salesOrder.id, salesOrderReleasePending.orderId))
        .innerJoin(salesOrderErpStage, eq(salesOrderErpStage.orderId, salesOrder.id))
        .where(where),
    ]);
    for (const row of grouped) perSector.set(row.sector, row.n);
    const last = overall[0]?.lastCheckedAt ?? null;
    return { perSector, total: overall[0]?.total ?? 0, lastCheckedAt: last === null ? null : new Date(last) };
  }
}
