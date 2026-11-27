import { Inject, Injectable } from '@nestjs/common';
import { erpPositivationOrder, erpSellerGoal, type Database } from '@salesforce/db';
import type { CustomerScope, PositivationOrder, SellerGoal } from '@salesforce/domain';
import { and, eq, max, type SQL } from 'drizzle-orm';
import { DATABASE } from '../platform/tokens.js';
import { inSellerCodes } from '../platform/sql.js';

/** Read side of the seller-goal mirror (TGFMET, read-only). The scope is pushed into the query on the goal's seller (P-21). */
@Injectable()
export class GoalsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async monthGoals(scope: CustomerScope, month: string): Promise<SellerGoal[]> {
    const conditions: (SQL | undefined)[] = [
      eq(erpSellerGoal.month, `${month}-01`),
      scope.kind === 'all' ? undefined : inSellerCodes(erpSellerGoal.sellerCode, scope.sellerCodes),
    ];
    const rows = await this.db
      .select({
        sellerCode: erpSellerGoal.sellerCode,
        month: erpSellerGoal.month,
        revenueTarget: erpSellerGoal.revenueTarget,
        quantityTarget: erpSellerGoal.quantityTarget,
        goalScope: erpSellerGoal.goalScope,
      })
      .from(erpSellerGoal)
      .where(and(...conditions));
    return rows.map((row) => ({
      sellerCode: row.sellerCode,
      month: row.month.slice(0, 7),
      revenueTarget: row.revenueTarget,
      quantityTarget: row.quantityTarget,
      scope: row.goalScope === 'general' ? 'general' : 'products',
    }));
  }

  /** When the goal mirror was last replaced (null while empty). */
  async syncedAt(): Promise<Date | null> {
    const [row] = await this.db.select({ at: max(erpSellerGoal.syncedAt) }).from(erpSellerGoal);
    return row?.at ?? null;
  }

  /**
   * Billed mobility orders of the month (goal positivation). Not narrowed by seller on purpose: a portfolio customer is positivated by an
   * order of any seller (the domain counts only the portfolio of the scope). Month rows are small (one per customer and order).
   */
  async monthPositivationOrders(month: string): Promise<PositivationOrder[]> {
    const rows = await this.db
      .select({
        customerCode: erpPositivationOrder.customerCode,
        sellerCode: erpPositivationOrder.sellerCode,
        month: erpPositivationOrder.month,
        orderNumber: erpPositivationOrder.orderNumber,
      })
      .from(erpPositivationOrder)
      .where(eq(erpPositivationOrder.month, `${month}-01`));
    return rows.map((row) => ({ ...row, month: row.month.slice(0, 7) }));
  }

  /** When the positivation mirror was last replaced (null while never synced: the table keeps up to 12 months, so a synced mirror is never empty in practice). */
  async positivationSyncedAt(): Promise<Date | null> {
    const [row] = await this.db.select({ at: max(erpPositivationOrder.syncedAt) }).from(erpPositivationOrder);
    return row?.at ?? null;
  }
}
