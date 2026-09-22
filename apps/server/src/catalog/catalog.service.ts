import { Inject, Injectable } from '@nestjs/common';
import {
  MAX_PRODUCT_RESOLUTION_CANDIDATES,
  type ProductDetail,
  type ProductGroupsResponse,
  type ProductListItem,
  type ProductResolutionItem,
  type ProductsQuery,
  type ProductsResponse,
  type ResolveProductsRequest,
  type ResolveProductsResponse,
} from '@salesforce/contracts';
import { isProductSellable, isProductVisible, type InstallationConfiguration, type Product } from '@salesforce/domain';
import { CustomersService } from '../customers/customers.service.js';
import { AppError } from '../http/app-error.js';
import type { CurrentUser } from '../iam/current-user.js';
import { PolicyService, type AccessContext } from '../iam/policy.service.js';
import {
  MirrorRepository,
  type PricedProductRow,
  type ProductFilter,
  type ProductRow,
} from '../mirror/mirror.repository.js';
import { fitsPgInt } from '../platform/sql.js';
import { CLOCK, type Clock } from '../platform/tokens.js';
import { PricingService, toListPriceContext, type PriceBook } from './pricing.service.js';

/** Mirror row to the domain's product (`unit` is nullable in the mirror, required in the domain shape). */
export function toDomainProduct(row: ProductRow): Product {
  return {
    code: row.code,
    description: row.description,
    active: row.active,
    usageCode: row.usageCode,
    groupCode: row.groupCode,
    unit: row.unit ?? '',
    brand: row.brand,
    reference: row.reference,
  };
}

/**
 * An identifier that can be a product code: canonical ASCII digits (no leading zero: "007" is not code 7, it can only
 * match a reference) within the ERP's integer range. Never normalised into a match.
 */
function isCodeIdentifier(identifier: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(identifier) && fitsPgInt(Number(identifier));
}

export function productFilterOf(config: InstallationConfiguration): Omit<ProductFilter, 'sort'> {
  return {
    sellableUsageValues: config.products.sellableUsageValues,
    showInactive: config.products.showInactive,
    productWithoutPriceVisible: config.products.productWithoutPrice.visible,
  };
}

/**
 * Catalog read side. Visibility, sellability and price state all come from the domain rules and the
 * installation configuration (CFG-3...6); SQL only narrows the page and a test keeps the two
 * consistent. Prices are list prices only: no cost, no margin (P-20).
 */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(MirrorRepository) private readonly mirror: MirrorRepository,
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async listGroups(user: CurrentUser): Promise<ProductGroupsResponse> {
    const { configuration } = await this.policy.accessContext(user);
    const groups = await this.mirror.listProductGroups(configuration.products.showInactive);
    return { items: groups.map((group) => ({ code: group.code, name: group.name ?? `Grupo ${group.code}` })) };
  }

  private async bookFor(context: AccessContext, customerCode: number | undefined): Promise<PriceBook> {
    const scope =
      customerCode === undefined
        ? this.pricing.forCatalogReference(context.configuration)
        : this.pricing.forCustomer(
            await this.customers.requireVisible(context.scope, customerCode),
            context.configuration,
          );
    return this.pricing.open(scope, this.clock());
  }

  private toListItem(row: PricedProductRow, book: PriceBook, config: InstallationConfiguration): ProductListItem {
    const product = toDomainProduct(row);
    return {
      code: row.code,
      description: row.description,
      active: row.active,
      sellable: isProductSellable(product, config),
      unit: product.unit,
      brand: row.brand,
      reference: row.reference,
      groupCode: row.groupCode,
      groupName: row.groupName,
      listPrice: toListPriceContext(this.pricing.priceOf(book, row.code, row.unitPrice)),
    };
  }

  async list(user: CurrentUser, query: ProductsQuery): Promise<ProductsResponse> {
    const context = await this.policy.accessContext(user);
    const book = await this.bookFor(context, query.customerCode);
    const { rows, total } = await this.mirror.listProducts(
      {
        ...productFilterOf(context.configuration),
        search: query.search,
        group: query.group,
        sellable: query.sellable,
        priceState: query.priceState,
        sort: query.sort,
      },
      book.versionId,
      { page: query.page, pageSize: query.pageSize },
    );
    return {
      items: rows.map((row) => this.toListItem(row, book, context.configuration)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      priceContext: await this.pricing.priceContext(book),
    };
  }

  async get(user: CurrentUser, code: number, customerCode: number | undefined): Promise<ProductDetail> {
    const context = await this.policy.accessContext(user);
    const book = await this.bookFor(context, customerCode);
    const row = await this.mirror.findProduct(code, book.versionId);
    if (row === null) throw new AppError('not_found');
    const item = this.toListItem(row, book, context.configuration);
    // A product the configuration hides from the catalog is not found here either.
    if (!isProductVisible(toDomainProduct(row), context.configuration, item.listPrice.state)) {
      throw new AppError('not_found');
    }
    return { ...item, usageCode: row.usageCode, priceContext: await this.pricing.priceContext(book) };
  }

  /**
   * Resolves a batch of pasted/imported identifiers, one answer per request position. Matching is
   * exact (product code when the identifier is all digits, product reference verbatim); a product the
   * configuration hides is not found, exactly as in `get`. Prices use the same book and mapping as
   * the catalog list. The identifiers are looked up once each, however often they repeat.
   */
  async resolve(user: CurrentUser, request: ResolveProductsRequest): Promise<ResolveProductsResponse> {
    const context = await this.policy.accessContext(user);
    const book = await this.bookFor(context, request.customerCode);
    const distinct = [...new Set(request.identifiers)];
    const codes = distinct.filter(isCodeIdentifier).map(Number);
    const rows = await this.mirror.findProductsByIdentifiers(codes, distinct, book.versionId);

    const byCode = new Map<number, ProductListItem>();
    const byReference = new Map<string, ProductListItem[]>();
    for (const row of rows) {
      const item = this.toListItem(row, book, context.configuration);
      if (!isProductVisible(toDomainProduct(row), context.configuration, item.listPrice.state)) continue;
      byCode.set(row.code, item);
      if (row.reference !== null) byReference.set(row.reference, [...(byReference.get(row.reference) ?? []), item]);
    }

    const answers = new Map<string, ProductResolutionItem>();
    for (const identifier of distinct) {
      const matches = new Map<number, ProductListItem>();
      const byCodeMatch = isCodeIdentifier(identifier) ? byCode.get(Number(identifier)) : undefined;
      if (byCodeMatch !== undefined) matches.set(byCodeMatch.code, byCodeMatch);
      for (const item of byReference.get(identifier) ?? []) matches.set(item.code, item);
      const found = [...matches.values()].sort((a, b) => a.code - b.code);
      const [only] = found;
      answers.set(
        identifier,
        found.length === 0 || only === undefined
          ? { identifier, status: 'not_found' }
          : found.length === 1
            ? { identifier, status: 'found', product: only }
            : { identifier, status: 'ambiguous', candidates: found.slice(0, MAX_PRODUCT_RESOLUTION_CANDIDATES) },
      );
    }

    return {
      items: request.identifiers.map((identifier) => answers.get(identifier) ?? { identifier, status: 'not_found' }),
      priceContext: await this.pricing.priceContext(book),
    };
  }
}
