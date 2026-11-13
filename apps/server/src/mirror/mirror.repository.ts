import { Inject, Injectable } from '@nestjs/common';
import {
  erpCustomer,
  erpListPrice,
  erpPriceTable,
  erpPriceTableVersion,
  erpProduct,
  erpSeller,
  erpCarrier,
  erpIpiRate,
  erpOpenTitle,
  erpProductGroup,
  type Database,
} from '@salesforce/db';
import { subtreeOf, visibleGroups, type GroupNode, type GroupRow } from './product-groups.js';
import type { CustomerScope, IpiRate, OpenTitle, PriceTableVersion } from '@salesforce/domain';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, not, or, sql, type SQL } from 'drizzle-orm';
import { DATABASE } from '../platform/tokens.js';
import { containsText, digitsOf, eqInt, fitsPgInt, inSellerCodes, offsetOf } from '../platform/sql.js';

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
  readonly monthlyCreditLimit: string | null;
  readonly blockReason: string | null;
  readonly situation: string | null;
  readonly syncedAt: Date;
}

export interface CustomerStateRow {
  readonly code: number;
  readonly name: string;
  readonly active: boolean;
  readonly blockedRaw: string | null;
  readonly sellerCode: number | null;
  /** The customer's own price table (`null` = the configured fallback decides). */
  readonly priceTableCode: number | null;
  /** Not deleted and flagged as a customer. */
  readonly live: boolean;
}

export interface CustomerListFilter {
  readonly scope: CustomerScope;
  readonly search?: string | undefined;
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
  /** Selling step (AGRUPMIN), numeric text as stored; null = none. */
  readonly quantityStep: string | null;
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
  /** Group code; its descendants of any depth are included (resolved here by the hierarchy). `0` = "Sem grupo". */
  readonly group?: number | undefined;
  readonly sellable?: boolean | undefined;
  /**
   * Internal diagnostic filter (dashboard only; NOT a public query parameter any more). When absent, a product is listed ONLY
   * with a price above zero in the effective version (owner ruling 2026-11-13).
   */
  readonly priceState?: ListPriceStateFilter | undefined;
  readonly sellableUsageValues: readonly string[];
  readonly showInactive: boolean;
  readonly sort: 'description' | '-description' | 'code' | '-code';
}

export interface CustomerCounts {
  readonly total: number;
  readonly withoutPriceTable: number;
}

function scopeCondition(scope: CustomerScope): SQL | undefined {
  return scope.kind === 'all' ? undefined : inSellerCodes(erpCustomer.sellerCode, scope.sellerCodes);
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
      input.scope.kind === 'all' ? undefined : inSellerCodes(erpSeller.code, input.scope.sellerCodes),
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
        monthlyCreditLimit: erpCustomer.monthlyCreditLimit,
        blockReason: erpCustomer.blockReason,
        situation: erpCustomer.situation,
        syncedAt: erpCustomer.syncedAt,
      })
      .from(erpCustomer)
      .leftJoin(erpSeller, and(eq(erpSeller.code, erpCustomer.sellerCode), isNull(erpSeller.deletedAt)))
      .leftJoin(
        erpPriceTable,
        and(eq(erpPriceTable.code, erpCustomer.priceTableCode), isNull(erpPriceTable.deletedAt)),
      );
  }

  /**
   * Customers the Force shows (owner ruling 2026-11-12, D-AQ): `ATIVO = 'S'` and `BLOQUEAR <> 'S'`. One rule for web and
   * mobile; a customer outside it disappears from every list, ficha and from the device cache at its next pull. Orders
   * and drafts already created read names through `customerNames`/`customerStates`, which do not use this rule.
   */
  private liveCustomer(): SQL[] {
    return [isNull(erpCustomer.deletedAt), eq(erpCustomer.isCustomer, true), eq(erpCustomer.active, true), not(blockedSql)];
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

    const where = and(
      ...this.liveCustomer(),
      scopeCondition(filter.scope),
      searchCondition,
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
  async findCustomer(scope: CustomerScope, code: number, options: { includeHidden?: boolean } = {}): Promise<CustomerRow | null> {
    if (!fitsPgInt(code)) return null;
    const base = options.includeHidden === true ? [isNull(erpCustomer.deletedAt), eq(erpCustomer.isCustomer, true)] : this.liveCustomer();
    const [row] = await this.customerSelect()
      .where(and(...base, eq(erpCustomer.code, code), scopeCondition(scope)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Open receivable titles of ONE customer (live rows, due date ascending) and when the latest of them was synced. No scope here:
   * the caller has already proved the customer visible (`findCustomer`). Read-only financial information (D-I).
   */
  async openTitlesOf(customerCode: number): Promise<{ titles: OpenTitle[]; syncedAt: Date | null }> {
    if (!fitsPgInt(customerCode)) return { titles: [], syncedAt: null };
    const rows = await this.db
      .select({
        nufin: erpOpenTitle.nufin,
        customerCode: erpOpenTitle.customerCode,
        companyCode: erpOpenTitle.companyCode,
        documentNumber: erpOpenTitle.documentNumber,
        dueDate: erpOpenTitle.dueDate,
        amount: erpOpenTitle.amount,
        paidAmount: erpOpenTitle.paidAmount,
        syncedAt: erpOpenTitle.syncedAt,
      })
      .from(erpOpenTitle)
      .where(and(eq(erpOpenTitle.customerCode, customerCode), isNull(erpOpenTitle.deletedAt)))
      .orderBy(asc(erpOpenTitle.dueDate), asc(erpOpenTitle.nufin));
    const syncedAt = rows.reduce<Date | null>((acc, r) => (acc === null || r.syncedAt > acc ? r.syncedAt : acc), null);
    return {
      titles: rows.map(({ syncedAt: _ignored, ...title }) => title),
      syncedAt,
    };
  }

  /** Which of these (already scoped) customers have at least one overdue open title (due date before `today`). */
  async overdueCustomerCodes(codes: readonly number[], today: string): Promise<Set<number>> {
    const usable = [...new Set(codes.filter(fitsPgInt))];
    if (usable.length === 0) return new Set();
    const rows = await this.db
      .selectDistinct({ customerCode: erpOpenTitle.customerCode })
      .from(erpOpenTitle)
      .where(
        and(
          inArray(erpOpenTitle.customerCode, usable),
          isNull(erpOpenTitle.deletedAt),
          lt(erpOpenTitle.dueDate, today),
          sql`${erpOpenTitle.amount} > ${erpOpenTitle.paidAmount}`,
        ),
      );
    return new Set(rows.map((r) => r.customerCode));
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

  /**
   * Current eligibility-relevant state of customers by code, WITHOUT a scope: only for orders the caller
   * already selected through the scope (order read model, submission revalidation). A code with no row
   * is absent from the map (= unavailable). Never exposes more than name, status flags and seller code.
   */
  async customerStates(codes: readonly number[]): Promise<Map<number, CustomerStateRow>> {
    const usable = [...new Set(codes.filter(fitsPgInt))];
    if (usable.length === 0) return new Map();
    const rows = await this.db
      .select({
        code: erpCustomer.code,
        name: erpCustomer.name,
        active: erpCustomer.active,
        blockedRaw: erpCustomer.blockedRaw,
        sellerCode: erpCustomer.sellerCode,
        priceTableCode: erpCustomer.priceTableCode,
        live: sql<boolean>`(${erpCustomer.deletedAt} is null and ${erpCustomer.isCustomer})`,
      })
      .from(erpCustomer)
      .where(inArray(erpCustomer.code, usable));
    return new Map(rows.map((row) => [row.code, row]));
  }

  async countCustomers(scope: CustomerScope): Promise<CustomerCounts> {
    const [row] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        withoutPriceTable: sql<number>`(count(*) filter (where ${erpCustomer.priceTableCode} is null))::int`,
      })
      .from(erpCustomer)
      .where(and(...this.liveCustomer(), scopeCondition(scope)));
    return {
      total: row?.total ?? 0,
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
      quantityStep: erpProduct.quantityStep,
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

  /** Group codes a group filter covers: the group and all its descendants; empty hierarchy table = the group alone (flat). */
  private async groupCodesOf(group: number | undefined): Promise<readonly number[] | undefined> {
    if (group === undefined || group === 0) return undefined;
    return subtreeOf(await this.loadGroups(), group);
  }

  private async loadGroups(): Promise<GroupRow[]> {
    return this.db
      .select({
        code: erpProductGroup.code,
        name: erpProductGroup.name,
        parentCode: erpProductGroup.parentCode,
        degree: erpProductGroup.degree,
        active: erpProductGroup.active,
      })
      .from(erpProductGroup)
      .where(isNull(erpProductGroup.deletedAt));
  }

  private groupCondition(group: number | undefined, groupCodes: readonly number[] | undefined): SQL | undefined {
    if (group === undefined) return undefined;
    // "Sem grupo": no group, or the ERP's group 0.
    if (group === 0) return or(isNull(erpProduct.groupCode), eq(erpProduct.groupCode, 0));
    return groupCodes === undefined || groupCodes.length === 0 ? eqInt(erpProduct.groupCode, group) : inArray(erpProduct.groupCode, [...groupCodes]);
  }

  private productWhere(filter: ProductFilter, versionId: number | null, groupCodes?: readonly number[]): SQL | undefined {
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
      // Owner ruling 2026-11-13: without an explicit diagnostic price state, only products with a price above zero.
      filter.priceState !== undefined ? undefined : hasVersion ? sql`${erpListPrice.unitPrice} > 0` : sql`false`,
      this.groupCondition(filter.group, groupCodes),
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
    const groupCodes = await this.groupCodesOf(filter.group);
    const where = this.productWhere(filter, versionId, groupCodes);
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
      this.countProducts(filter, versionId, groupCodes),
    ]);
    return { rows, total };
  }

  async countProducts(filter: ProductFilter, versionId: number | null, resolvedGroupCodes?: readonly number[]): Promise<number> {
    const groupCodes = resolvedGroupCodes ?? (await this.groupCodesOf(filter.group));
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(erpProduct)
      .leftJoin(erpListPrice, this.priceJoin(versionId))
      .where(this.productWhere(filter, versionId, groupCodes));
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

  /**
   * Codes (among `codes`) of products the mirror holds only as removed rows: the product is no longer in the mobility-filtered
   * read (AD_MOBILIDADE no longer 'S', or gone from the ERP). Used to tell "Produto sem mobilidade" from "unknown" (owner ruling 2026-11-13).
   */
  async findRemovedProductCodes(codes: readonly number[]): Promise<Set<number>> {
    const usable = [...new Set(codes.filter(fitsPgInt))];
    if (usable.length === 0) return new Set();
    const live = await this.findProducts(usable);
    const liveCodes = new Set(live.map((row) => row.code));
    const rows = await this.db
      .select({ code: erpProduct.code })
      .from(erpProduct)
      .where(and(isNotNull(erpProduct.deletedAt), inArray(erpProduct.code, usable)));
    return new Set(rows.map((row) => row.code).filter((code) => !liveCodes.has(code)));
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

  /** IPI codes of the products and the mirrored rates (display estimate, D-D). Products without a code are absent. */
  async ipiLookup(productCodes: readonly number[]): Promise<{ codes: Map<number, number>; rates: Map<number, IpiRate> }> {
    const usable = [...new Set(productCodes.filter(fitsPgInt))];
    const codes = new Map<number, number>();
    const rates = new Map<number, IpiRate>();
    if (usable.length === 0) return { codes, rates };
    const products = await this.db
      .select({ code: erpProduct.code, ipiCode: erpProduct.ipiCode })
      .from(erpProduct)
      .where(and(isNull(erpProduct.deletedAt), inArray(erpProduct.code, usable)));
    for (const product of products) if (product.ipiCode !== null) codes.set(product.code, product.ipiCode);
    const wanted = [...new Set(codes.values())];
    if (wanted.length === 0) return { codes, rates };
    const rows = await this.db
      .select()
      .from(erpIpiRate)
      .where(and(isNull(erpIpiRate.deletedAt), inArray(erpIpiRate.code, wanted)));
    for (const row of rows) {
      rates.set(row.code, { code: row.code, percentual: row.percentual, byTariff: row.byTariff, description: row.description, rateMissing: row.rateMissing });
    }
    return { codes, rates };
  }

  /** Active carriers, ordered by name (D-C). Code and name only. */
  async listCarriers(): Promise<{ code: number; name: string }[]> {
    return this.db
      .select({ code: erpCarrier.code, name: erpCarrier.name })
      .from(erpCarrier)
      .where(and(isNull(erpCarrier.deletedAt), eq(erpCarrier.active, true)))
      .orderBy(asc(erpCarrier.name), asc(erpCarrier.code));
  }

  /** Whether the code is an active, not-deleted mirrored carrier (validation of the order carrier). */
  async carrierIsActive(code: number): Promise<boolean> {
    if (!fitsPgInt(code)) return false;
    const rows = await this.db
      .select({ code: erpCarrier.code })
      .from(erpCarrier)
      .where(and(eq(erpCarrier.code, code), isNull(erpCarrier.deletedAt), eq(erpCarrier.active, true)))
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Groups for the Grupo > Subgrupo > Linha filter. While `erp_product_group` is empty (new table, before its first sync) it falls
   * back to the flat list derived from the products (`hierarchical: false`, no parent). `hasUngrouped` = some counted product has
   * no group (null or 0), which makes the client offer "Sem grupo".
   */
  async listProductGroups(showInactive: boolean): Promise<{ items: GroupNode[]; hierarchical: boolean; hasUngrouped: boolean }> {
    const counted = and(isNull(erpProduct.deletedAt), showInactive ? undefined : eq(erpProduct.active, true));
    const [rows, groups, ungrouped] = await Promise.all([
      this.db
        .select({ code: erpProduct.groupCode, name: sql<string | null>`max(${erpProduct.groupName})` })
        .from(erpProduct)
        .where(and(counted, isNotNull(erpProduct.groupCode), sql`${erpProduct.groupCode} <> 0`))
        .groupBy(erpProduct.groupCode),
      this.loadGroups(),
      this.db
        .select({ one: sql<number>`1` })
        .from(erpProduct)
        .where(and(counted, or(isNull(erpProduct.groupCode), eq(erpProduct.groupCode, 0))))
        .limit(1),
    ]);
    const hasUngrouped = ungrouped.length > 0;
    if (groups.length === 0) {
      const flat = rows.flatMap((row) =>
        row.code === null
          ? []
          : [{ code: row.code, name: row.name ?? `Grupo ${row.code}`, parentCode: null, degree: 1, hasChildren: false }],
      );
      flat.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.code - b.code);
      return { items: flat, hierarchical: false, hasUngrouped };
    }
    const withProducts = new Set(rows.flatMap((row) => (row.code === null ? [] : [row.code])));
    return { items: visibleGroups(groups, withProducts), hierarchical: true, hasUngrouped };
  }
}
