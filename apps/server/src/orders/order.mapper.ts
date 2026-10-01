import type { OrderDetail, OrderItem as OrderItemDto, OrderListItem, OrderReview, OrderStatus } from '@salesforce/contracts';
import { computeOrderTotals, customerOrderBlock, normalizeDecimalString } from '@salesforce/domain';
import { isBlockedRaw } from '../mirror/mirror.repository.js';
import type { OrderCustomerState, OrderItemRow, OrderListRow, OrderRow } from './orders.repository.js';

/** Display name when the customer is no longer in the mirror (never an empty name in a list). */
export function customerNameOrFallback(name: string | null | undefined, code: number): string {
  return name ?? `Cliente ${code}`;
}

/**
 * A draft whose customer is no longer eligible (inactive, blocked, no valid seller, or gone from the
 * mirror) needs review: derived from the CURRENT customer state on every read, never persisted and never
 * a change of the draft. Only drafts are flagged (cancelled/other statuses are not sendable anyway).
 */
export function reviewOf(status: string, customer: OrderCustomerState): OrderReview | null {
  if (status !== 'draft') return null;
  const block = customerOrderBlock(
    customer.customerLive !== true || customer.customerActive === null
      ? null
      : {
          active: customer.customerActive,
          blocked: isBlockedRaw(customer.customerBlockedRaw),
          sellerCode: customer.customerSellerCode,
        },
  );
  return block === null ? null : { status: 'needs_review', reason: 'customer_ineligible', customerBlock: block };
}

export function toOrderListItem(row: OrderListRow): OrderListItem {
  const { order } = row;
  return {
    id: order.id,
    draftNumber: order.draftNumber,
    customerCode: order.customerCode,
    customerName: customerNameOrFallback(row.customerName, order.customerCode),
    sellerCode: order.sellerCode,
    status: order.status as OrderStatus,
    estimatedTotal: order.estimatedTotal,
    itemCount: row.itemCount,
    itemPreview: [...row.itemPreview],
    isPartial: row.unpricedCount > 0,
    erpNumber: order.erpNumber,
    review: reviewOf(order.status, row),
    version: order.version,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

function toItemDto(row: OrderItemRow): OrderItemDto {
  return {
    lineNo: row.lineNo,
    productCode: row.productCode,
    productDescription: row.productDescription,
    unit: row.unit ?? '',
    quantity: normalizeDecimalString(row.quantity),
    unitListPrice: row.unitListPrice === null ? null : normalizeDecimalString(row.unitListPrice),
    priceState: row.priceState as OrderItemDto['priceState'],
    priceTableCode: row.priceTableCode,
    priceVersionId: row.priceVersionId,
    discountPercent: normalizeDecimalString(row.discountPercent),
    estimatedLineTotal: row.estimatedLineTotal,
  };
}

/** Order + its lines as the contract detail. Totals are recomputed by the domain from the stored lines. */
export function toOrderDetail(order: OrderRow, items: readonly OrderItemRow[], customer: OrderCustomerState): OrderDetail {
  const dtoItems = items.map(toItemDto);
  const totals = computeOrderTotals(dtoItems);
  return {
    id: order.id,
    draftNumber: order.draftNumber,
    customerCode: order.customerCode,
    customerName: customerNameOrFallback(customer.customerName, order.customerCode),
    sellerCode: order.sellerCode,
    status: order.status as OrderStatus,
    estimatedTotal: order.estimatedTotal,
    itemCount: dtoItems.length,
    isPartial: totals.isPartial,
    erpNumber: order.erpNumber,
    review: reviewOf(order.status, customer),
    version: order.version,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    negotiationTypeCode: order.negotiationTypeCode,
    notes: order.notes,
    items: dtoItems,
    totals,
  };
}
