import { Inject, Injectable } from '@nestjs/common';
import type { OrderDetail, OrderPriceReview, PriceReviewLine, ResolvePriceReviewRequest } from '@salesforce/contracts';
import { isOrderEditable, pricesDiffer, resolvePriceReview } from '@salesforce/domain';
import { AppError } from '../http/app-error.js';
import { AUDIT_ACTIONS, AuditService } from '../iam/audit.service.js';
import type { CurrentUser } from '../iam/current-user.js';
import { PolicyService } from '../iam/policy.service.js';
import { CustomersService } from '../customers/customers.service.js';
import { DraftBuilder } from './draft-builder.js';
import { OrdersService } from './orders.service.js';

/**
 * P-09: a draft whose table price changed goes through a review, never a silent replacement. The review lists the lines whose
 * price differs from today's table; the seller accepts (the line takes the table price) or refuses (the line leaves the order).
 * Both reads and the resolution go through `OrdersService`, so scope, dataset, version, editability and pricing are enforced
 * server-side exactly as in a normal edit.
 */
@Injectable()
export class OrderPriceReviewService {
  constructor(
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(DraftBuilder) private readonly builder: DraftBuilder,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async review(user: CurrentUser, id: string): Promise<OrderPriceReview> {
    const order = await this.orders.get(user, id);
    return { orderId: order.id, version: order.version, lines: await this.changedLines(user, order) };
  }

  async resolve(user: CurrentUser, id: string, body: ResolvePriceReviewRequest): Promise<OrderDetail> {
    const order = await this.orders.get(user, id);
    if (order.version !== body.expectedVersion) throw new AppError('version_conflict', { details: { currentVersion: order.version } });
    const changed = await this.changedLines(user, order);
    const outcome = resolvePriceReview(
      changed.map((line) => line.lineNo),
      body.decisions,
    );
    if (!outcome.ok) {
      throw new AppError('validation_failed', {
        message: 'Decida o preço de todos os itens alterados.',
        details: { issues: outcome.lineNos.map((lineNo) => ({ path: `decisions[lineNo=${lineNo}]`, code: outcome.reason })) },
      });
    }
    const refused = new Set(outcome.refused);
    const kept = order.items.filter((item) => !refused.has(item.lineNo));
    if (kept.length === 0) {
      throw new AppError('validation_failed', {
        message: 'O pedido precisa ficar com ao menos um item.',
        details: { issues: [{ path: 'decisions', code: 'order_would_be_empty' }] },
      });
    }
    const updated = await this.orders.replace(user, id, {
      expectedVersion: body.expectedVersion,
      expectedDataset: body.expectedDataset,
      customerCode: order.customerCode,
      negotiationTypeCode: order.negotiationTypeCode,
      notes: order.notes,
      items: kept.map((item) => ({ productCode: item.productCode, quantity: item.quantity, discountPercent: item.discountPercent })),
    });
    await this.audit.record({
      action: AUDIT_ACTIONS.orderPriceReviewed,
      actorAccountId: user.accountId,
      detail: { orderId: id, accepted: body.decisions.length - outcome.refused.length, refused: outcome.refused.length },
    });
    return updated;
  }

  private async changedLines(user: CurrentUser, order: OrderDetail): Promise<PriceReviewLine[]> {
    if (!isOrderEditable(order.status as Parameters<typeof isOrderEditable>[0]) || order.items.length === 0) return [];
    const context = await this.policy.accessContext(user);
    const customer = await this.customers.requireForOrder(context.scope, order.customerCode);
    const request = (items: typeof order.items) => ({
      customer: { code: customer.code, sellerCode: customer.sellerCode, priceTableCode: customer.priceTableCode },
      negotiationTypeCode: order.negotiationTypeCode,
      notes: order.notes,
      items: items.map((item) => ({ productCode: item.productCode, quantity: item.quantity, discountPercent: item.discountPercent })),
    });
    const priceOf = new Map<number, string | null>();
    const all = await this.builder.build(request(order.items), context.configuration);
    if (all.ok) {
      for (const built of all.draft.items) priceOf.set(built.productCode, built.unitListPrice);
    } else {
      // One line without a price (or unknown) fails the whole build: ask line by line so each one gets its own answer.
      for (const item of order.items) {
        const one = await this.builder.build(request([item]), context.configuration);
        priceOf.set(item.productCode, one.ok ? (one.draft.items[0]?.unitListPrice ?? null) : null);
      }
    }
    return order.items
      .filter((item) => pricesDiffer(item.unitListPrice, priceOf.get(item.productCode) ?? null))
      .map((item) => ({
        lineNo: item.lineNo,
        productCode: item.productCode,
        productDescription: item.productDescription,
        unit: item.unit,
        quantity: item.quantity,
        previousUnitPrice: item.unitListPrice,
        currentUnitPrice: priceOf.get(item.productCode) ?? null,
      }));
  }
}
