import { Inject, Injectable } from '@nestjs/common';
import { erpSalesHistoryCustomerProduct, erpSalesHistoryMonthly, type Database } from '@salesforce/db';
import type { CustomerScope, SalesHistoryMonthlyBucket } from '@salesforce/domain';
import { and, asc, eq, gte, lte, max, type SQL } from 'drizzle-orm';
import { DATABASE } from '../platform/tokens.js';
import { eqInt, inSellerCodes } from '../platform/sql.js';

/** One product line of a customer's history: one row per product and TOP kind, as mirrored. */
export interface CustomerProductHistoryRow {
  readonly productCode: number;
  readonly topKind: 'sale' | 'return';
  readonly noteCount: number;
  readonly quantity: string;
  readonly netAmount: string;
  readonly lastSaleDate: string;
}

export interface SalesHistoryMonthlyFilter {
  readonly scope: CustomerScope;
  /** First and last month, inclusive, as `YYYY-MM`. */
  readonly fromMonth: string;
  readonly toMonth: string;
  readonly sellerCode?: number | undefined;
}

function toBucketKind(kind: string): 'sale' | 'return' | 'other' {
  return kind === 'sale' || kind === 'return' ? kind : 'other';
}

/**
 * Read side of the sales-history mirror (stage D). The tables carry no cost, margin or commission column. The monthly read takes the
 * caller's scope as an argument and pushes it into the query on the NOTE's seller; there is no unscoped monthly read in this class (P-21).
 * The per-customer read is unscoped on purpose: the service proves the customer visible first (`MirrorRepository.findCustomer`).
 */
@Injectable()
export class SalesHistoryRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async monthlyBuckets(filter: SalesHistoryMonthlyFilter): Promise<SalesHistoryMonthlyBucket[]> {
    const conditions: (SQL | undefined)[] = [
      gte(erpSalesHistoryMonthly.month, `${filter.fromMonth}-01`),
      lte(erpSalesHistoryMonthly.month, `${filter.toMonth}-01`),
      filter.scope.kind === 'all' ? undefined : inSellerCodes(erpSalesHistoryMonthly.sellerCode, filter.scope.sellerCodes),
      filter.sellerCode === undefined ? undefined : eqInt(erpSalesHistoryMonthly.sellerCode, filter.sellerCode),
    ];
    const rows = await this.db
      .select({
        customerCode: erpSalesHistoryMonthly.customerCode,
        sellerCode: erpSalesHistoryMonthly.sellerCode,
        month: erpSalesHistoryMonthly.month,
        topCode: erpSalesHistoryMonthly.topCode,
        topKind: erpSalesHistoryMonthly.topKind,
        noteCount: erpSalesHistoryMonthly.noteCount,
        totalAmount: erpSalesHistoryMonthly.totalAmount,
      })
      .from(erpSalesHistoryMonthly)
      .where(and(...conditions))
      .orderBy(asc(erpSalesHistoryMonthly.sellerCode), asc(erpSalesHistoryMonthly.month));
    return rows.map((row) => ({
      customerCode: row.customerCode,
      sellerCode: row.sellerCode,
      month: row.month.slice(0, 7),
      topCode: row.topCode,
      topKind: toBucketKind(row.topKind),
      noteCount: row.noteCount,
      totalAmount: row.totalAmount,
    }));
  }

  /** Everything one customer bought or returned. The caller has already proved the customer visible. */
  async customerProducts(customerCode: number): Promise<CustomerProductHistoryRow[]> {
    const rows = await this.db
      .select({
        productCode: erpSalesHistoryCustomerProduct.productCode,
        topKind: erpSalesHistoryCustomerProduct.topKind,
        noteCount: erpSalesHistoryCustomerProduct.noteCount,
        quantity: erpSalesHistoryCustomerProduct.quantity,
        netAmount: erpSalesHistoryCustomerProduct.netAmount,
        lastSaleDate: erpSalesHistoryCustomerProduct.lastSaleDate,
      })
      .from(erpSalesHistoryCustomerProduct)
      .where(eq(erpSalesHistoryCustomerProduct.customerCode, customerCode))
      .orderBy(asc(erpSalesHistoryCustomerProduct.productCode));
    return rows.flatMap((row) =>
      row.topKind === 'sale' || row.topKind === 'return' ? [{ ...row, topKind: row.topKind }] : [],
    );
  }

  /** When the monthly mirror was last replaced (null while empty). */
  async monthlySyncedAt(): Promise<Date | null> {
    const [row] = await this.db.select({ at: max(erpSalesHistoryMonthly.syncedAt) }).from(erpSalesHistoryMonthly);
    return row?.at ?? null;
  }
}
