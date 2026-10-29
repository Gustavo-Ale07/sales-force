import { Inject, Injectable } from '@nestjs/common';
import { account, erpCustomer, salesOrder, salesOrderApproval, salesOrderItem, type ApprovalLevel, type Database } from '@salesforce/db';
import type { CustomerScope } from '@salesforce/domain';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { inSellerCodes, offsetOf } from '../platform/sql.js';
import { DATABASE } from '../platform/tokens.js';
import type { ApprovalRow, Executor } from './orders.repository.js';

export interface QueueRow {
  readonly approval: ApprovalRow;
  readonly draftNumber: number;
  readonly customerCode: number;
  readonly customerName: string | null;
  readonly sellerCode: number | null;
  readonly ownerName: string;
  readonly estimatedTotal: string;
  readonly itemCount: number;
  readonly maxDiscountPercent: string;
}

/** The discount approval queue and the decision write (W-20). Reads only the pending requests of the given levels, inside the data scope. */
@Injectable()
export class ApprovalsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async listPending(
    levels: readonly ApprovalLevel[],
    scope: CustomerScope,
    page: { page: number; pageSize: number },
  ): Promise<{ rows: QueueRow[]; total: number }> {
    const scopeCondition: SQL | undefined = scope.kind === 'all' ? undefined : inSellerCodes(salesOrder.sellerCode, scope.sellerCodes);
    const where = and(
      eq(salesOrderApproval.decision, 'pending'),
      inArray(salesOrderApproval.requestedLevel, [...levels]),
      eq(salesOrder.status, 'awaiting_approval'),
      scopeCondition,
    );
    const [rows, totals] = await Promise.all([
      this.db
        .select({
          approval: salesOrderApproval,
          draftNumber: salesOrder.draftNumber,
          customerCode: salesOrder.customerCode,
          customerName: erpCustomer.name,
          sellerCode: salesOrder.sellerCode,
          ownerName: account.displayName,
          estimatedTotal: salesOrder.estimatedTotal,
          itemCount: sql<number>`(select count(*)::int from ${salesOrderItem} where ${salesOrderItem.orderId} = ${salesOrder.id})`,
          maxDiscountPercent: sql<string>`(select coalesce(max(${salesOrderItem.discountPercent}), 0)::text from ${salesOrderItem} where ${salesOrderItem.orderId} = ${salesOrder.id})`,
        })
        .from(salesOrderApproval)
        .innerJoin(salesOrder, eq(salesOrder.id, salesOrderApproval.orderId))
        .innerJoin(account, eq(account.id, salesOrder.createdByAccountId))
        .leftJoin(erpCustomer, eq(erpCustomer.code, salesOrder.customerCode))
        .where(where)
        .orderBy(asc(salesOrderApproval.requestedAt), asc(salesOrderApproval.id))
        .limit(page.pageSize)
        .offset(offsetOf(page.page, page.pageSize)),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(salesOrderApproval)
        .innerJoin(salesOrder, eq(salesOrder.id, salesOrderApproval.orderId))
        .where(where),
    ]);
    return { rows, total: totals[0]?.total ?? 0 };
  }

  async findById(id: string, executor: Executor = this.db, lock = false): Promise<ApprovalRow | null> {
    const query = executor.select().from(salesOrderApproval).where(eq(salesOrderApproval.id, id));
    const [row] = await (lock ? query.for('update') : query);
    return row ?? null;
  }

  /** Records the decision on a request that is still pending; `false` when it no longer is. */
  async decide(
    id: string,
    values: { decision: 'approved' | 'rejected'; decidedByAccountId: string; decidedAt: Date; comment: string | null },
    executor: Executor,
  ): Promise<boolean> {
    const rows = await executor
      .update(salesOrderApproval)
      .set(values)
      .where(and(eq(salesOrderApproval.id, id), eq(salesOrderApproval.decision, 'pending')))
      .returning({ id: salesOrderApproval.id });
    return rows.length > 0;
  }
}
