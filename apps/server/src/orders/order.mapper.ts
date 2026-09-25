import type { OrderDetail, OrderItem as OrderItemDto, OrderListItem, OrderStatus } from '@salesforce/contracts';
import { computeOrderTotals, normalizeDecimalString } from '@salesforce/domain';
import type { OrderItemRow, OrderListRow, OrderRow } from './orders.repository.js';

/** Display name when the customer is no longer in the mirror (never an empty name in a list). */
export function customerNameOrFallback(name: string | null | undefined, code: number): string {
  return name ?? `Cliente ${code}`;
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
    estimatedLineTotal: row.estimatedLineTotal,
  };
}

/** Order + its lines as the contract detail. Totals are recomputed by the domain from the stored lines. */
export function toOrderDetail(order: OrderRow, items: readonly OrderItemRow[], customerName: string | null): OrderDetail {
  const dtoItems = items.map(toItemDto);
  const totals = computeOrderTotals(dtoItems);
  return {
    id: order.id,
    draftNumber: order.draftNumber,
    customerCode: order.customerCode,
    customerName: customerNameOrFallback(customerName, order.customerCode),
    sellerCode: order.sellerCode,
    status: order.status as OrderStatus,
    estimatedTotal: order.estimatedTotal,
    itemCount: dtoItems.length,
    isPartial: totals.isPartial,
    erpNumber: order.erpNumber,
    version: order.version,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    negotiationTypeCode: order.negotiationTypeCode,
    notes: order.notes,
    items: dtoItems,
    totals,
  };
}
