import { FreightTypeSchema, type FreightType } from '@salesforce/contracts';
import type { DiscountAuthorityStatus, OrderApproval, OrderDetail, OrderItemDetail as OrderItemDto, OrderListItem, OrderReview, OrderStatus, ProductImage } from '@salesforce/contracts';
import { computeOrderIpi, computeOrderTotals, customerOrderBlock, normalizeDecimalString, type IpiRate } from '@salesforce/domain';
import { isBlockedRaw } from '../mirror/mirror.repository.js';
import { decodeReleaseDetail, decodeReleaseEventCodes, storedReleaseState } from './release-events.js';
import type { ApprovalWithDecider, OrderCustomerState, OrderItemRow, OrderListRow, OrderRow } from './orders.repository.js';

export interface IpiLookup {
  readonly codes: ReadonlyMap<number, number>;
  readonly rates: ReadonlyMap<number, IpiRate>;
}

/** The stored freight text as a freight type; anything else (never written by the API) reads as none. */
export function freightTypeOf(value: string | null): FreightType | null {
  const parsed = FreightTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

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

/**
 * ERP release state as last read by the worker; null until read or when the ERP has no release lines. The event list
 * (description per line) is a detail-only addition (`withEvents`). The releasing user is never stored, so never exposed.
 */
export function erpReleaseOf(order: OrderRow, withEvents = false): OrderListItem['erpRelease'] {
  const detail = decodeReleaseDetail(order.erpStatusDetail);
  if (detail === null) return null;
  const base = { state: storedReleaseState(detail), checkedAt: detail.checkedAt };
  if (!withEvents) return base;
  return { ...base, events: detail.lines.map((line) => ({ code: line.code, label: line.description, state: line.state })) };
}

/**
 * K3: the stable code of a stored delivery error. The stored text is `<code>: <masked message>`; only the code leaves
 * the server, and only when it has the identifier shape. Orders that are not `rejected` carry nothing.
 */
export function erpDeliveryOf(status: string, errorClass: string | null, message: string | null): OrderListItem['erpDelivery'] {
  if (status !== 'rejected' || errorClass === null) return null;
  const head = message === null ? '' : (message.split(':', 1)[0] ?? '').trim();
  const errorCode = /^[a-z][a-z0-9_]{0,63}$/.test(head) ? head : null;
  const reason = errorCode === ERP_REFUSED_CODE ? erpRefusalText(message) : null;
  return reason === null ? { errorClass, errorCode } : { errorClass, errorCode, message: reason };
}

const ERP_REFUSED_CODE = 'erp_refused_order';
const ERP_REFUSAL_PREFIX = 'erp_refused_order: The ERP refused the order: ';
const ERP_REFUSAL_MAX = 200;

/**
 * The ERP's own refusal text out of the stored `erp_refused_order: The ERP refused the order: <statusMessage>.` (already
 * masked when stored, D-Q). Only this one code exposes text; the placeholder "no message" and empty text give `null`.
 */
function erpRefusalText(stored: string | null): string | null {
  if (stored === null || !stored.startsWith(ERP_REFUSAL_PREFIX)) return null;
  const text = stored.slice(ERP_REFUSAL_PREFIX.length).replace(/\.$/, '').replace(/\s+/g, ' ').trim();
  if (text === '' || text === 'no message' || looksTechnical(text)) return null;
  return text.slice(0, ERP_REFUSAL_MAX);
}

/**
 * Security review (2026-11-09): the text is Sankhya's free text and its error format was never observed, so anything that
 * looks like a database error, an exception, a stack trace or an internal table/column name is NOT shown to users (the
 * screen then says only "O Sankhya recusou o pedido"). The full masked text stays in the delivery WARN log and in
 * `integration_outbox.last_error_message` for IT. Business refusals in plain words ("O campo 'Perc. desconto' deve ser
 * informado.") pass.
 */
const TECHNICAL_TEXT: readonly RegExp[] = [
  /\bORA-\d+/i,
  /\bSQL(?:STATE|EXCEPTION|CODE|ERROR)?\b/i,
  /exception|\bstack\s?trace\b|\bcaused by\b|\btraceback\b/i,
  /\bat\s+[\w$.]+\([^)]*\)/, // "at br.com.Foo.bar(Foo.java:12)"
  /\bat\s+\S*[\\/]\S+/, // "at /opt/app/file.js", "at C:\\dir\\file"
  /\b(?:java|javax|com|br|org|sun)\.[a-z]\w*\./i, // package names
  /\bT(?:GF|SI|CS|GW|FP|SP)[A-Z0-9]+\b/, // TGFITE, TSIUSU...
  /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/, // COLUMN_NAME, AD_FORCEORIGEM
];

function looksTechnical(text: string): boolean {
  return TECHNICAL_TEXT.some((pattern) => pattern.test(text));
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
    freightType: freightTypeOf(order.freightType),
    estimatedTotal: order.estimatedTotal,
    itemCount: row.itemCount,
    itemPreview: [...row.itemPreview],
    isPartial: row.unpricedCount > 0,
    erpNumber: order.erpNumber,
    erpStatus: erpStatusOf(order),
    erpRelease: erpReleaseOf(order),
    erpDelivery: erpDeliveryOf(order.status, row.deliveryErrorClass, row.deliveryErrorMessage),
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
  ipiLookup: IpiLookup = { codes: new Map(), rates: new Map() },
  showExpedicao = false,
  lastDelivery: { errorClass: string | null; message: string | null } | null = null,
  dryRun: { at: Date; payloadHash: string } | null = null,
  convertedInto: { id: string; draftNumber: number; erpNumber: number | null } | null = null,
): OrderDetail {
  const baseItems = items.map((item) => toItemDto(item, images.get(item.productCode)));
  const totals = computeOrderTotals(baseItems);
  // D-D: estimated IPI from the NET line total; display only, never part of validation or the ERP payload.
  const ipi = computeOrderIpi(
    baseItems.map((item) => ({ lineNetTotal: item.estimatedLineTotal, ipiCode: ipiLookup.codes.get(item.productCode) ?? null })),
    totals.estimatedTotal,
    ipiLookup.rates,
  );
  const dtoItems = baseItems.map((item, index) => ({ ...item, ipi: ipi.lines[index]! }));
  return {
    id: order.id,
    draftNumber: order.draftNumber,
    customerCode: order.customerCode,
    customerName: customerNameOrFallback(customer.customerName, order.customerCode),
    sellerCode: order.sellerCode,
    status: order.status as OrderStatus,
    topCode: order.topCode,
    carrierCode: order.carrierCode,
    freightType: freightTypeOf(order.freightType),
    estimatedTotal: order.estimatedTotal,
    itemCount: dtoItems.length,
    isPartial: totals.isPartial,
    erpNumber: order.erpNumber,
    erpStatus: erpStatusOf(order, liberationEventLabels),
    erpRelease: erpReleaseOf(order, true),
    erpDelivery: erpDeliveryOf(order.status, lastDelivery?.errorClass ?? null, lastDelivery?.message ?? null),
    review: reviewOf(order.status, customer),
    version: order.version,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    ...(dryRun === null ? {} : { dryRun: { at: dryRun.at.toISOString(), payloadHash: dryRun.payloadHash } }),
    negotiationTypeCode: order.negotiationTypeCode,
    notes: order.notes,
    sourceOrderId: order.sourceOrderId,
    ...(convertedInto === null ? {} : { convertedInto }),
    discountAuthority: order.discountAuthority as DiscountAuthorityStatus,
    approval,
    // D-O: read-only, only for admin/technical; no seller screen ever carries it.
    ...(showExpedicao ? { expedicao: order.expedicao } : {}),
    items: dtoItems,
    totals,
    ipi: {
      ipiEstimated: ipi.ipiEstimated,
      grandTotalEstimated: ipi.grandTotalEstimated,
      unavailableLineCount: ipi.unavailableLineCount,
      tariffLineCount: ipi.tariffLineCount,
      exemptLineCount: ipi.exemptLineCount,
      isPartial: ipi.isPartial,
    },
  };
}
