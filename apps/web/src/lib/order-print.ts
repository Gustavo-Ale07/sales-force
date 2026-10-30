import type { ApiSchema } from "@salesforce/contracts/client";
import { renderOrderHtml, toOrderDocument } from "@salesforce/domain";

type OrderDetail = ApiSchema<"OrderDetail">;

/** State texts of the printed order. User text says "Sankhya", not "ERP" (D-L). */
export const orderDocumentStatusLabels: Record<ApiSchema<"OrderStatus">, string> = {
  draft: "Rascunho",
  awaiting_approval: "Aguardando aprovação",
  approved: "Aprovado",
  approval_rejected: "Reprovado na aprovação",
  cancelled: "Descartado",
  queued: "Na fila para o Sankhya",
  sent: "Enviado ao Sankhya",
  rejected: "Falha no envio",
  unknown: "Envio em verificação",
};

/** The order screen's data, restricted by the domain allow-list (never cost/margin: P-20), rendered with the shared PLAC template. */
export function buildOrderHtml(order: OrderDetail, origin: string): string {
  const model = toOrderDocument({
    draftNumber: order.draftNumber,
    erpNumber: order.erpNumber,
    customerCode: order.customerCode,
    customerName: order.customerName,
    statusLabel: orderDocumentStatusLabels[order.status],
    createdAt: order.createdAt,
    notes: order.notes,
    items: order.items,
    totals: order.totals,
  });
  return renderOrderHtml(model, { logoSrc: `${origin}/brand/plac-logo.png`, brandName: 'PLAC' });
}
