import { Inject, Injectable } from '@nestjs/common';
import { erpSellerGoal, type Database } from '@salesforce/db';
import type { CustomerScope, SellerGoal } from '@salesforce/domain';
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
      })
      .from(erpSellerGoal)
      .where(and(...conditions));
    return rows.map((row) => ({
      sellerCode: row.sellerCode,
      month: row.month.slice(0, 7),
      revenueTarget: row.revenueTarget,
      quantityTarget: row.quantityTarget,
    }));
  }

  /** When the goal mirror was last replaced (null while empty). */
  async syncedAt(): Promise<Date | null> {
    const [row] = await this.db.select({ at: max(erpSellerGoal.syncedAt) }).from(erpSellerGoal);
    return row?.at ?? null;
  }
}
