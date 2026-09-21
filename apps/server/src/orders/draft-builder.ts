import { Inject, Injectable } from '@nestjs/common';
import type { OrderItemInput } from '@salesforce/contracts';
import {
  buildOrderItem,
  computeOrderTotals,
  validateDraftInvariants,
  type DraftIssue,
  type InstallationConfiguration,
  type OrderItem,
  type OrderTotals,
  type Product,
  type SalesOrderDraft,
} from '@salesforce/domain';
import { PricingService } from '../catalog/pricing.service.js';
import { toDomainProduct } from '../catalog/catalog.service.js';
import { MirrorRepository } from '../mirror/mirror.repository.js';
import { CLOCK, type Clock } from '../platform/tokens.js';

export interface DraftRequest {
  readonly customer: { readonly code: number; readonly sellerCode: number | null; readonly priceTableCode: number | null };
  readonly negotiationTypeCode: number | null;
  readonly notes: string | null;
  readonly items: readonly OrderItemInput[];
}

export type DraftOutcome =
  | { readonly ok: true; readonly draft: SalesOrderDraft; readonly totals: OrderTotals }
  | { readonly ok: false; readonly issues: readonly DraftIssue[] };

/**
 * Turns a requested draft (product + quantity per line) into priced lines. Prices come only from the
 * mirror through the domain (`resolveListPrice`, `buildOrderItem`); a client-sent price is not an
 * input (P-09). The invariants are the domain's `validateDraftInvariants`: this class adds no rule of
 * its own, it only loads the data and maps issue paths back to the request's line positions.
 */
@Injectable()
export class DraftBuilder {
  constructor(
    @Inject(MirrorRepository) private readonly mirror: MirrorRepository,
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async build(request: DraftRequest, config: InstallationConfiguration): Promise<DraftOutcome> {
    const productCodes = [...new Set(request.items.map((item) => item.productCode))];
    const productRows = await this.mirror.findProducts(productCodes);
    const products = new Map<number, Product>(productRows.map((row) => [row.code, toDomainProduct(row)]));

    const book = await this.pricing.open(this.pricing.forCustomer(request.customer, config), this.clock());
    const prices = await this.pricing.priceMany(book, productCodes);

    const issues: DraftIssue[] = [];
    const built: OrderItem[] = [];
    /** Position in the request of each built line (failed lines are skipped, positions must not shift). */
    const requestIndex: number[] = [];

    request.items.forEach((line, index) => {
      const product = products.get(line.productCode);
      const price = prices.get(line.productCode);
      if (product === undefined || price === undefined) {
        issues.push({ code: 'product_unknown', path: `items[${index}].productCode` });
        return;
      }
      const item = buildOrderItem({ lineNo: index + 1, product, quantity: line.quantity, price });
      if (!item.ok) {
        issues.push({ code: 'invalid_quantity', path: `items[${index}].quantity` });
        return;
      }
      built.push(item.value);
      requestIndex.push(index);
    });

    const totals = computeOrderTotals(built);
    const draft: SalesOrderDraft = {
      customerCode: request.customer.code,
      sellerCode: request.customer.sellerCode,
      status: 'draft',
      negotiationTypeCode: request.negotiationTypeCode,
      notes: request.notes,
      items: built,
      estimatedTotal: totals.estimatedTotal,
    };

    for (const issue of validateDraftInvariants(draft, config, { products })) {
      issues.push({
        code: issue.code,
        path: issue.path.replace(/^items\[(\d+)\]/, (_match, position: string) => {
          return `items[${requestIndex[Number(position)] ?? Number(position)}]`;
        }),
      });
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true, draft, totals };
  }
}
