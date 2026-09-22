import { Inject, Injectable } from '@nestjs/common';
import {
  erpCustomer,
  erpListPrice,
  erpPriceTable,
  erpPriceTableVersion,
  erpProduct,
  erpSeller,
  type Database,
} from '@salesforce/db';
import type { CustomerScope, PriceTableVersion } from '@salesforce/domain';
import { and, asc, desc, eq, inArray, isNotNull, isNull, not, or, sql, type SQL } from 'drizzle-orm';
import { DATABASE } from '../platform/tokens.js';
import { containsText, digitsOf, eqInt, fitsPgInt, inInts, offsetOf } from '../platform/sql.js';

/**
 * Read side of the ERP mirror (`erp_*`). The mirror tables are written only by the worker's sync
 * jobs; the API reads them here and nowhere else. Every customer/seller list takes the caller's scope
 * as an argument: there is no unscoped customer query in this class (P-21). No cost, margin or
 * commission column exists in the mirror, and none is selected here (P-20).
 */

/** Raw `blocked_raw` values read as "blocked" (`S` = the ERP flag, `true`/`1` for booleans). NEEDS VALIDATION (S4). */
const BLOCKED_RAW_VALUES = ['S', 'TRUE', '1'] as const;
const blockedSql = sql`coalesce(upper(trim(${erpCustomer.blockedRaw})) in ('S', 'TRUE', '1'), false)`;

export function isBlockedRaw(raw: string | null): boolean {
  return raw !== null && (BLOCKED_RAW_VALUES as readonly string[]).includes(raw.trim().toUpperCase());
}

export interface Page {
  readonly page: number;
  readonly pageSize: number;
}

export interface CustomerRow {
  readonly code: number;
  readonly name: string;
  readonly tradeName: string | null;
  readonly taxId: string | null;
  readonly active: boolean;
  readonly blockedRaw: string | null;
  readonly sellerCode: number | null;
  readonly sellerName: string | null;
  readonly priceTableCode: number | null;
  readonly priceTableName: string | null;
  readonly creditLimit: string | null;
  readonly syncedAt: Date;
}

export type CustomerStatusFilter = 'active' | 'inactive' | 'blocked';

export interface CustomerListFilter {
  readonly scope: CustomerScope;
  readonly search?: string | undefined;
  readonly status?: CustomerStatusFilter | undefined;
  readonly sellerCode?: number | undefined;
  readonly hasPriceTable?: boolean | undefined;
  readonly sort: 'name' | '-name' | 'code' | '-code';
}

export interface SellerRow {
  readonly code: number;
  readonly name: string;
  readonly active: boolean;
}

export interface ProductRow {
  readonly code: number;
  readonly description: string;
  readonly reference: string | null;
  readonly brand: string | null;
  readonly unit: string | null;
  readonly groupCode: number | null;
  readonly groupName: string | null;
  readonly usageCode: string | null;
  readonly active: boolean;
}

/** A catalog row plus the price row of the effective version (`unitPrice` null = no row = "no price"). */
export interface PricedProductRow extends ProductRow {
  readonly unitPrice: string | null;
}

export type ListPriceStateFilter = 'priced' | 'zero' | 'none';

/** Catalog rules already derived from the installation configuration (the caller passes them in). */
export interface ProductFilter {
  readonly search?: string | undefined;
  readonly group?: number | undefined;
  readonly sellable?: boolean | undefined;
  readonly priceState?: ListPriceStateFilter | undefined;
  readonly sellableUsageValues: readonly string[];
  readonly showInactive: boolean;
  readonly productWithoutPriceVisible: boolean;
  readonly sort: 'description' | '-description' | 'code' | '-code';
}

export interface CustomerCounts {
  readonly total: number;
  readonly active: number;
  readonly blocked: number;
  readonly withoutPriceTable: number;
}

function scopeCondition(scope: CustomerScope): SQL | undefined {
  return scope.kind === 'all' ? undefined : inInts(erpCustomer.sellerCode, scope.sellerCodes);
}

@Injectable()
export class MirrorRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /* ---------- sellers ---------- */

  async listSellers(input: {
    readonly scope: CustomerScope;
    readonly search?: string | undefined;
    readonly active?: boolean | undefined;
  }): Promise<SellerRow[]> {
    const conditions = [
      isNull(erpSeller.deletedAt),
      input.scope.kind === 'all' ? undefined : inInts(erpSeller.code, input.scope.sellerCodes),
      input.active === undefined ? undefined : eq(erpSeller.active, input.active),
      input.search === undefined ? undefined : containsText(erpSeller.name, input.search),
    ];
    return this.db
      .select({ code: erpSeller.code, name: erpSeller.name, active: erpSeller.active })
      .from(erpSeller)
      .where(and(...conditions))
      .orderBy(asc(erpSeller.name), asc(erpSeller.code));
  }

  /* ---------- customers ---------- */

  private customerSelect() {
    return this.db
      .select({
        code: erpCustomer.code,
        name: erpCustomer.name,
        tradeName: erpCustomer.tradeName,
        taxId: erpCustomer.taxId,
        active: erpCustomer.active,
        blockedRaw: erpCustomer.blockedRaw,
        sellerCode: erpCustomer.sellerCode,
        sellerName: erpSeller.name,
        priceTableCode: erpCustomer.priceTableCode,
        priceTableName: erpPriceTable.name,
        creditLimit: erpCustomer.creditLimit,
        syncedAt: erpCustomer.syncedAt,
      })
      .from(erpCustomer)
      .leftJoin(erpSeller, and(eq(erpSeller.code, erpCustomer.sellerCode), isNull(erpSeller.deletedAt)))
      .leftJoin(
        erpPriceTable,
        and(eq(erpPriceTable.code, erpCustomer.priceTableCode), isNull(erpPriceTable.deletedAt)),
      );
  }

  private liveCustomer(): SQL[] {
    return [isNull(erpCustomer.deletedAt), eq(erpCustomer.isCustomer, true)];
  }

  async listCustomers(
    filter: CustomerListFilter,
    page: Page,
  ): Promise<{ rows: CustomerRow[]; total: number }> {
    const digits = filter.search === undefined ? null : digitsOf(filter.search);
    const searchCondition =
      filter.search === undefined
        ? undefined
        : or(
            containsText(erpCustomer.name, filter.search),
            containsText(erpCustomer.tradeName, filter.search),
            digits === null ? undefined : sql`${erpCustomer.taxId} like ${`%${digits}%`}`,
            digits === null ? undefined : eqInt(erpCustomer.code, Number(digits)),
          );

    let statusCondition: SQL | undefined;
    if (filter.status === 'active') statusCondition = and(eq(erpCustomer.active, true), not(blockedSql));
    else if (filter.status === 'inactive') statusCondition = eq(erpCustomer.active, false);
    else if (filter.status === 'blocked') statusCondition = blockedSql;

    const where = and(
      ...this.liveCustomer(),
      scopeCondition(filter.scope),
      searchCondition,
      statusCondition,
      filter.sellerCode === undefined ? undefined : eqInt(erpCustomer.sellerCode, filter.sellerCode),
      filter.hasPriceTable === undefined
        ? undefined
        : filter.hasPriceTable
          ? isNotNull(erpCustomer.priceTableCode)
          : isNull(erpCustomer.priceTableCode),
    );

    const order =
      filter.sort === 'name'
        ? [asc(erpCustomer.name), asc(erpCustomer.code)]
        : filter.sort === '-name'
          ? [desc(erpCustomer.name), desc(erpCustomer.code)]
          : filter.sort === 'code'
            ? [asc(erpCustomer.code)]
            : [desc(erpCustomer.code)];

    const [rows, totals] = await Promise.all([
      this.customerSelect()
        .where(where)
        .orderBy(...order)
        .limit(page.pageSize)
        .offset(offsetOf(page.page, page.pageSize)),
      this.db.select({ total: sql<number>`count(*)::int` }).from(erpCustomer).where(where),
    ]);
    return { rows, total: totals[0]?.total ?? 0 };
  }

  /**
   * One customer, only when it lies inside the scope (the scope is part of the WHERE, so an
   * out-of-scope customer is indistinguishable from a missing one).
   */
  async findCustomer(scope: CustomerScope, code: number): Promise<CustomerRow | null> {
    if (!fitsPgInt(code)) return null;
    const [row] = await this.customerSelect()
      .where(and(...this.liveCustomer(), eq(erpCustomer.code, code), scopeCondition(scope)))
      .limit(1);
    return row ?? null;
  }

  /** Display names of customers by code (order lists); the caller already selected visible orders. */
  async customerNames(codes: readonly number[]): Promise<Map<number, string>> {
    const usable = [...new Set(codes.filter(fitsPgInt))];
    if (usable.length === 0) return new Map();
    const rows = await this.db
      .select({ code: erpCustomer.code, name: erpCustomer.name })
      .from(erpCustomer)
      .where(inArray(erpCustomer.code, usable));
    return new Map(rows.map((row) => [row.code, row.name]));
  }

  async countCustomers(scope: CustomerScope): Promise<CustomerCounts> {
    const [row] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`(count(*) filter (where ${erpCustomer.active} and not ${blockedSql}))::int`,
        blocked: sql<number>`(count(*) filter (where ${blockedSql}))::int`,
        withoutPriceTable: sql<number>`(count(*) filter (where ${erpCustomer.priceTableCode} is null))::int`,
      })
      .from(erpCustomer)
      .where(and(...this.liveCustomer(), scopeCondition(scope)));
    return {
      total: row?.total ?? 0,
      active: row?.active ?? 0,
      blocked: row?.blocked ?? 0,
      withoutPriceTable: row?.withoutPriceTable ?? 0,
    };
  }

  /* ---------- price tables ---------- */

  async priceTableName(code: number): Promise<string | null> {
    if (!fitsPgInt(code)) return null;
    const [row] = await this.db
      .select({ name: erpPriceTable.name })
      .from(erpPriceTable)
      .where(and(eq(erpPriceTable.code, code), isNull(erpPriceTable.deletedAt)));
    return row?.name ?? null;
  }

  /** Stored versions of a table (superseded ones included; the domain picks the effective one). */
  async priceTableVersions(tableCode: number): Promise<PriceTableVersion[]> {
    if (!fitsPgInt(tableCode)) return [];
    const rows = await this.db
      .select({
        versionId: erpPriceTableVersion.versionId,
        tableCode: erpPriceTableVersion.tableCode,
        effectiveFrom: erpPriceTableVersion.effectiveFrom,
      })
      .from(erpPriceTableVersion)
      .where(and(eq(erpPriceTableVersion.tableCode, tableCode), isNull(erpPriceTableVersion.deletedAt)));
    return rows.map((row) => ({
      versionId: row.versionId,
      tableCode: row.tableCode,
      effectiveFrom: row.effectiveFrom.toISOString(),
    }));
  }

  /** Price rows of one version for the given products (an absent row = no price). */
  async listPrices(versionId: number, productCodes: readonly number[]): Promise<Map<number, string>> {
    const usable = [...new Set(productCodes.filter(fitsPgInt))];
    if (!fitsPgInt(versionId) || usable.length === 0) return new Map();
    const rows = await this.db
      .select({ productCode: erpListPrice.productCode, unitPrice: erpListPrice.unitPrice })
      .from(erpListPrice)
      .where(
        and(
          eq(erpListPrice.versionId, versionId),
          inArray(erpListPrice.productCode, usable),
          isNull(erpListPrice.deletedAt),
        ),
      );
    return new Map(rows.map((row) => [row.productCode, row.unitPrice]));
  }

  /* ---------- products ---------- */

  private productSelectFields() {
    return {
      code: erpProduct.code,
      description: erpProduct.description,
      reference: erpProduct.reference,
      brand: erpProduct.brand,
      unit: erpProduct.unit,
      groupCode: erpProduct.groupCode,
      groupName: erpProduct.groupName,
      usageCode: erpProduct.usageCode,
      active: erpProduct.active,
    };
  }

  /** Join condition for the price row of the effective version; with no version it never matches. */
  private priceJoin(versionId: number | null): SQL | undefined {
    const versionMatch = versionId === null ? sql`false` : eqInt(erpListPrice.versionId, versionId);
    return and(versionMatch, eq(erpListPrice.productCode, erpProduct.code), isNull(erpListPrice.deletedAt));
  }

  private sellableCondition(values: readonly string[]): SQL {
    const usage =
      values.length === 0 ? sql`false` : inArray(erpProduct.usageCode, [...values]);
    return sql`(${erpProduct.active} = true and ${erpProduct.usageCode} is not null and ${usage})`;
  }

  private productWhere(filter: ProductFilter, versionId: number | null): SQL | undefined {
    const digits = filter.search === undefined ? null : digitsOf(filter.search);
    const searchCondition =
      filter.search === undefined
        ? undefined
        : or(
            containsText(erpProduct.description, filter.search),
            containsText(erpProduct.reference, filter.search),
            digits === null ? undefined : eqInt(erpProduct.code, Number(digits)),
          );

    // Price state of the effective version: no row / zero row / positive row (same classes as the domain).
    const hasVersion = versionId !== null;
    let priceCondition: SQL | undefined;
    if (filter.priceState === 'none') priceCondition = hasVersion ? isNull(erpListPrice.productCode) : undefined;
    else if (filter.priceState === 'zero')
      priceCondition = hasVersion ? sql`${erpListPrice.unitPrice} = 0` : sql`false`;
    else if (filter.priceState === 'priced')
      priceCondition = hasVersion ? sql`${erpListPrice.unitPrice} > 0` : sql`false`;

    const sellable = this.sellableCondition(filter.sellableUsageValues);
    return and(
      isNull(erpProduct.deletedAt),
      filter.showInactive ? undefined : eq(erpProduct.active, true),
      filter.productWithoutPriceVisible
        ? undefined
        : hasVersion
          ? sql`${erpListPrice.unitPrice} > 0`
          : sql`false`,
      filter.group === undefined ? undefined : eqInt(erpProduct.groupCode, filter.group),
      filter.sellable === undefined ? undefined : filter.sellable ? sellable : not(sellable),
      priceCondition,
      searchCondition,
    );
  }

  async listProducts(
    filter: ProductFilter,
    versionId: number | null,
    page: Page,
  ): Promise<{ rows: PricedProductRow[]; total: number }> {
    const where = this.productWhere(filter, versionId);
    const order =
      filter.sort === 'description'
        ? [asc(erpProduct.description), asc(erpProduct.code)]
        : filter.sort === '-description'
          ? [desc(erpProduct.description), desc(erpProduct.code)]
          : filter.sort === 'code'
            ? [asc(erpProduct.code)]
            : [desc(erpProduct.code)];
    const [rows, total] = await Promise.all([
      this.db
        .select({ ...this.productSelectFields(), unitPrice: erpListPrice.unitPrice })
        .from(erpProduct)
        .leftJoin(erpListPrice, this.priceJoin(versionId))
        .where(where)
        .orderBy(...order)
        .limit(page.pageSize)
        .offset(offsetOf(page.page, page.pageSize)),
      this.countProducts(filter, versionId),
    ]);
    return { rows, total };
  }

  async countProducts(filter: ProductFilter, versionId: number | null): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(erpProduct)
      .leftJoin(erpListPrice, this.priceJoin(versionId))
      .where(this.productWhere(filter, versionId));
    return row?.total ?? 0;
  }

  /** One live product with its price row in the effective version (visibility rules are the caller's). */
  async findProduct(code: number, versionId: number | null): Promise<PricedProductRow | null> {
    if (!fitsPgInt(code)) return null;
    const [row] = await this.db
      .select({ ...this.productSelectFields(), unitPrice: erpListPrice.unitPrice })
      .from(erpProduct)
      .leftJoin(erpListPrice, this.priceJoin(versionId))
      .where(and(isNull(erpProduct.deletedAt), eq(erpProduct.code, code)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Live products whose code is one of `codes`, or whose reference is exactly one of `references`
   * (`=`, case-sensitive: no LIKE, no normalization), each with its price row in the effective
   * version. One parametrized query for the whole batch, ordered by code. The caller applies the
   * visibility rules and decides what an identifier resolved to.
   */
  async findProductsByIdentifiers(
    codes: readonly number[],
    references: readonly string[],
    versionId: number | null,
  ): Promise<PricedProductRow[]> {
    const usableCodes = [...new Set(codes.filter(fitsPgInt))];
    const usableReferences = [...new Set(references)];
    if (usableCodes.length === 0 && usableReferences.length === 0) return [];
    const matches = or(
      usableCodes.length === 0 ? undefined : sql`${erpProduct.code} = any(${sql.param(usableCodes)}::int[])`,
      usableReferences.length === 0 ? undefined : sql`${erpProduct.reference} = any(${sql.param(usableReferences)}::text[])`,
    );
    return this.db
      .select({ ...this.productSelectFields(), unitPrice: erpListPrice.unitPrice })
      .from(erpProduct)
      .leftJoin(erpListPrice, this.priceJoin(versionId))
      .where(and(isNull(erpProduct.deletedAt), matches))
      .orderBy(asc(erpProduct.code));
  }

  /** Live products by code (order lines). */
  async findProducts(codes: readonly number[]): Promise<ProductRow[]> {
    const usable = [...new Set(codes.filter(fitsPgInt))];
    if (usable.length === 0) return [];
    return this.db
      .select(this.productSelectFields())
      .from(erpProduct)
      .where(and(isNull(erpProduct.deletedAt), inArray(erpProduct.code, usable)));
  }

  async listProductGroups(showInactive: boolean): Promise<{ code: number; name: string | null }[]> {
    const rows = await this.db
      .select({ code: erpProduct.groupCode, name: sql<string | null>`max(${erpProduct.groupName})` })
      .from(erpProduct)
      .where(
        and(
          isNull(erpProduct.deletedAt),
          isNotNull(erpProduct.groupCode),
          showInactive ? undefined : eq(erpProduct.active, true),
        ),
      )
      .groupBy(erpProduct.groupCode)
      .orderBy(sql`max(${erpProduct.groupName}) asc nulls last`, asc(erpProduct.groupCode));
    return rows.flatMap((row) => (row.code === null ? [] : [{ code: row.code, name: row.name }]));
  }
}
