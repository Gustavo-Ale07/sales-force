import type { ApiSchema } from "@salesforce/contracts/client";
import { documentFreightLabels, documentStatusLabels, documentIpiPercent, documentKindOf, orderDocumentConditions, renderOrderHtml, resolveDocumentCarrier, toOrderDocument, type DocumentTopRules, type OrderDocumentCompany, type OrderDocumentCustomerRegistry } from "@salesforce/domain";

type OrderDetail = ApiSchema<"OrderDetail">;

/** State texts of the printed order. User text says "Sankhya", not "ERP" (D-L). */
export const orderDocumentStatusLabels: Record<ApiSchema<"OrderStatus">, string> = documentStatusLabels;

export const freightTypeLabels: Record<NonNullable<OrderDetail["freightType"]>, string> = documentFreightLabels;

/** The order screen's data, restricted by the domain allow-list (never cost/margin: P-20), rendered with the shared PLAC template. */
export interface OrderPrintExtras {
  /** Quote/order TOP rules from the installation configuration (J3); absent = printed as an order. */
  topRules?: DocumentTopRules;
  /** Negotiation types of the order-entry configuration, to print the label instead of the code; absent = the code. */
  negotiationTypes?: readonly { code: number; label: string }[];
  /** Moment of issue (the caller's clock). */
  issuedAt?: string;
  sellerName?: string;
  /** `brand.company` of the runtime configuration; absent = no company block. */
  company?: OrderDocumentCompany;
  /** Name of the order's own carrier (resolved from `carrierCode` in the carriers list); absent = falls back to the customer's default. */
  carrierName?: string | null;
  /** Default carrier of the customer, from the Sankhya registry. */
  customerDefaultCarrierName?: string | null;
  /** Registry data of the customer (mirror or what the Force recorded); absent fields print a dash. */
  customerRegistry?: OrderDocumentCustomerRegistry;
}

export function buildOrderHtml(order: OrderDetail, origin: string, extras: OrderPrintExtras = {}): string {
  const model = toOrderDocument({
    kind: documentKindOf(order.topCode, extras.topRules ?? {}),
    // The internal number is never shown (owner rule 2026-11-23): identity is the Sankhya number only.
    erpNumber: order.erpNumber,
    customerCode: order.customerCode,
    customerName: order.customerName,
    customerRegistry: extras.customerRegistry ?? {},
    carrierName: resolveDocumentCarrier(extras.carrierName, extras.customerDefaultCarrierName),
    conditions: orderDocumentConditions({
      negotiationTypeCode: order.negotiationTypeCode,
      ...(extras.negotiationTypes === undefined ? {} : { negotiationTypes: extras.negotiationTypes }),
      freightLabel: order.freightType === null ? null : freightTypeLabels[order.freightType],
    }),
    statusLabel: orderDocumentStatusLabels[order.status],
    createdAt: order.createdAt,
    notes: order.notes,
    // `barcode` is additive on the contract (EAN from the ERP mirror); absent from older servers.
    items: order.items.map((item) => ({ ...item, ipiPercent: documentIpiPercent(item.ipi), barcode: (item as { barcode?: string | null }).barcode ?? null })),
    totals: order.totals,
    ...(order.ipi === undefined ? {} : { ipi: order.ipi }),
  });
  return renderOrderHtml(model, {
    logoSrc: `${origin}/brand/plac-logo.png`,
    brandName: 'PLAC',
    ...(order.erpNumber == null ? {} : { title: `${model.kind === "quote" ? "Orçamento" : "Pedido"} ${order.erpNumber}` }),
    ...(extras.issuedAt === undefined ? {} : { issuedAt: extras.issuedAt }),
    ...(extras.sellerName === undefined ? {} : { sellerName: extras.sellerName }),
    ...(extras.company === undefined ? {} : { company: extras.company }),
  });
}
