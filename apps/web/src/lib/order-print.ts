import type { ApiSchema } from "@salesforce/contracts/client";
import { documentKindOf, renderOrderHtml, toOrderDocument, type DocumentTopRules, type OrderDocumentCompany } from "@salesforce/domain";

type OrderDetail = ApiSchema<"OrderDetail">;

/** State texts of the printed order. User text says "Sankhya", not "ERP" (D-L). */
export const orderDocumentStatusLabels: Record<ApiSchema<"OrderStatus">, string> = {
  draft: "Rascunho",
  awaiting_approval: "Aguardando aprovação",
  approved: "Aprovado",
  approval_rejected: "Reprovado na aprovação",
  queued: "Enviando ao Sankhya",
  sent: "Enviado ao Sankhya",
  rejected: "Falha no envio",
  unknown: "Verificando envio…",
};

/** The order screen's data, restricted by the domain allow-list (never cost/margin: P-20), rendered with the shared PLAC template. */
export interface OrderPrintExtras {
  /** Quote/order TOP rules from the installation configuration (J3); absent = printed as an order. */
  topRules?: DocumentTopRules;
  /** Moment of issue (the caller's clock). */
  issuedAt?: string;
  sellerName?: string;
  /** `brand.company` of the runtime configuration; absent = no company block. */
  company?: OrderDocumentCompany;
}

export function buildOrderHtml(order: OrderDetail, origin: string, extras: OrderPrintExtras = {}): string {
  const model = toOrderDocument({
    kind: documentKindOf(order.topCode, extras.topRules ?? {}),
    draftNumber: order.draftNumber,
    erpNumber: order.erpNumber,
    customerCode: order.customerCode,
    customerName: order.customerName,
    statusLabel: orderDocumentStatusLabels[order.status],
    createdAt: order.createdAt,
    notes: order.notes,
    items: order.items,
    totals: order.totals,
    ...(order.ipi === undefined ? {} : { ipi: order.ipi }),
  });
  return renderOrderHtml(model, {
    logoSrc: `${origin}/brand/plac-logo.png`,
    brandName: 'PLAC',
    ...(extras.issuedAt === undefined ? {} : { issuedAt: extras.issuedAt }),
    ...(extras.sellerName === undefined ? {} : { sellerName: extras.sellerName }),
    ...(extras.company === undefined ? {} : { company: extras.company }),
  });
}
