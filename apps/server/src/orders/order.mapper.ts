import type { DiscountAuthorityStatus, OrderApproval, OrderDetail, OrderItemDetail as OrderItemDto, OrderListItem, OrderReview, OrderStatus, ProductImage } from '@salesforce/contracts';
import { computeOrderTotals, customerOrderBlock, normalizeDecimalString } from '@salesforce/domain';
import { isBlockedRaw } from '../mirror/mirror.repository.js';
import { decodeReleaseEventCodes } from './release-events.js';
import type { ApprovalWithDecider, OrderCustomerState, OrderItemRow, OrderListRow, OrderRow } from './orders.repository.js';

export function toOrderApproval(found: ApprovalWithDecider | null): OrderApproval | null {
  if (found === null) return null;
  const { approval, decidedByName } = found;
  return {
    requestedLevel: approval.requestedLevel as OrderApproval['requestedLevel'],
    requestedAt: approval.requestedAt.toISOString(),
    decision: approval.decision as OrderApproval['decision'],
    decidedAt: approval.decidedAt === null ? null : approval.decidedAt.toISOString(),
    decidedByName: approval.decision === 'approved' || approval.decision === 'rejected' ? decidedByName : null,
    comment: approval.comment,
  };
}

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

/** ERP status as last read by the worker (P2); null until the first read. */
export function erpStatusOf(order: OrderRow, liberationEventLabels?: Readonly<Record<string, string>>): OrderListItem['erpStatus'] {
  if (order.erpStatusCode == null || order.erpStatusLabel == null || order.erpStatusCheckedAt == null) return null;
  const base = {
    code: order.erpStatusCode,
    label: order.erpStatusLabel,
    invoiceNumber: order.erpInvoiceNumber ?? null,
    checkedAt: order.erpStatusCheckedAt.toISOString(),
  };
  // D6b: release events are a detail-only addition (the list item stays small); the label is optional configuration.
  if (liberationEventLabels === undefined) return base;
  const releaseEvents = decodeReleaseEventCodes(order.erpStatusDetail).map((code) => ({
    code,
    label: liberationEventLabels[String(code)] ?? null,
  }));
  return releaseEvents.length === 0 ? base : { ...base, releaseEvents };
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
    topCode: order.topCode,
    carrierCode: order.carrierCode,
    estimatedTotal: order.estimatedTotal,
    itemCount: row.itemCount,
    itemPreview: [...row.itemPreview],
    isPartial: row.unpricedCount > 0,
    erpNumber: order.erpNumber,
    erpStatus: erpStatusOf(order),
    review: reviewOf(order.status, row),
    version: order.version,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

function toItemDto(row: OrderItemRow, image?: ProductImage): OrderItemDto {
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
    ...(image === undefined ? {} : { image }),
  };
}

/** Order + its lines as the contract detail. Totals are recomputed by the domain from the stored lines. */
export function toOrderDetail(
  order: OrderRow,
  items: readonly OrderItemRow[],
  customer: OrderCustomerState,
  images: ReadonlyMap<number, ProductImage> = new Map(),
  approval: OrderApproval | null = null,
  liberationEventLabels: Readonly<Record<string, string>> = {},
): OrderDetail {
  const dtoItems = items.map((item) => toItemDto(item, images.get(item.productCode)));
  const totals = computeOrderTotals(dtoItems);
  return {
    id: order.id,
    draftNumber: order.draftNumber,
    customerCode: order.customerCode,
    customerName: customerNameOrFallback(customer.customerName, order.customerCode),
    sellerCode: order.sellerCode,
    status: order.status as OrderStatus,
    topCode: order.topCode,
    carrierCode: order.carrierCode,
    estimatedTotal: order.estimatedTotal,
    itemCount: dtoItems.length,
    isPartial: totals.isPartial,
    erpNumber: order.erpNumber,
    erpStatus: erpStatusOf(order, liberationEventLabels),
    review: reviewOf(order.status, customer),
    version: order.version,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    negotiationTypeCode: order.negotiationTypeCode,
    notes: order.notes,
    sourceOrderId: order.sourceOrderId,
    discountAuthority: order.discountAuthority as DiscountAuthorityStatus,
    approval,
    items: dtoItems,
    totals,
  };
}
