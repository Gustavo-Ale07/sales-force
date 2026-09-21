import { Inject, Injectable } from '@nestjs/common';
import type { ListPriceContext, PriceContext } from '@salesforce/contracts';
import {
  findEffectiveVersion,
  resolveCustomerPriceTable,
  resolveListPrice,
  type InstallationConfiguration,
  type PriceTableVersion,
  type ResolvedPrice,
  type ResolvedPriceTable,
} from '@salesforce/domain';
import { MirrorRepository } from '../mirror/mirror.repository.js';

/** Which table prices are read from, and why (`source` is what the response reports). */
export interface PriceScope {
  readonly customerCode: number | null;
  readonly table: ResolvedPriceTable;
  readonly source: PriceContext['source'];
}

/** One table at one instant: its stored versions and the version the domain says is effective. */
export interface PriceBook {
  readonly scope: PriceScope;
  readonly versions: readonly PriceTableVersion[];
  readonly versionId: number | null;
  readonly at: string;
}

/**
 * Application glue between the price mirror and the domain pricing rules. The rules themselves
 * (table resolution, effective version, price state, "no price is never 0") stay in
 * `@salesforce/domain`; this service only loads the mirrored rows they need (P-09, P-14).
 */
@Injectable()
export class PricingService {
  constructor(@Inject(MirrorRepository) private readonly mirror: MirrorRepository) {}

  /** Prices for a customer: its own table, or the configured fallback, or "no resolved table". */
  forCustomer(customer: { code: number; priceTableCode: number | null }, config: InstallationConfiguration): PriceScope {
    const table = resolveCustomerPriceTable({ priceTableCode: customer.priceTableCode }, config);
    return {
      customerCode: customer.code,
      table,
      source: table.kind === 'table' ? table.source : 'none',
    };
  }

  /** Prices for browsing without a customer: the configured catalog reference table, if any. */
  forCatalogReference(config: InstallationConfiguration): PriceScope {
    const code = config.pricing.catalogReferenceTableCode;
    if (code === null) return { customerCode: null, table: { kind: 'no_resolved_table' }, source: 'none' };
    // `source` inside the domain table only says who chose it; the response reports 'catalog_reference'.
    return { customerCode: null, table: { kind: 'table', code, source: 'fallback' }, source: 'catalog_reference' };
  }

  async open(scope: PriceScope, at: Date): Promise<PriceBook> {
    const iso = at.toISOString();
    if (scope.table.kind === 'no_resolved_table') return { scope, versions: [], versionId: null, at: iso };
    const versions = await this.mirror.priceTableVersions(scope.table.code);
    const effective = findEffectiveVersion(scope.table.code, versions, iso);
    return { scope, versions, versionId: effective?.versionId ?? null, at: iso };
  }

  /** The domain's price for a product given the mirrored unit price of the effective version (`null` = no row). */
  priceOf(book: PriceBook, productCode: number, unitPrice: string | null): ResolvedPrice {
    return resolveListPrice({
      productCode,
      table: book.scope.table,
      versions: book.versions,
      findPrice: (versionId, code) =>
        unitPrice === null ? undefined : { versionId, productCode: code, unitPrice },
      at: book.at,
    });
  }

  /** Prices of several products (order lines): one query for the effective version. */
  async priceMany(book: PriceBook, productCodes: readonly number[]): Promise<Map<number, ResolvedPrice>> {
    const rows =
      book.versionId === null ? new Map<number, string>() : await this.mirror.listPrices(book.versionId, productCodes);
    const result = new Map<number, ResolvedPrice>();
    for (const code of productCodes) result.set(code, this.priceOf(book, code, rows.get(code) ?? null));
    return result;
  }

  async priceContext(book: PriceBook): Promise<PriceContext> {
    const { scope } = book;
    const tableCode = scope.table.kind === 'table' ? scope.table.code : null;
    return {
      customerCode: scope.customerCode,
      tableCode,
      tableName: tableCode === null ? null : await this.mirror.priceTableName(tableCode),
      source: scope.source,
    };
  }
}

/** Domain price to the contract shape; a missing price is `none` with a reason, never `0`. */
export function toListPriceContext(price: ResolvedPrice): ListPriceContext {
  if (price.state === 'none') {
    return {
      state: 'none',
      unitPrice: null,
      tableCode: price.tableCode,
      versionId: price.versionId,
      noPriceReason: price.reason,
    };
  }
  return {
    state: price.state,
    unitPrice: price.unitPrice,
    tableCode: price.tableCode,
    versionId: price.versionId,
    noPriceReason: null,
  };
}
