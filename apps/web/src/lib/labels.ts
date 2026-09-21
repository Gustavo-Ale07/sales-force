import type { ApiSchema } from "@salesforce/contracts/client";
import type { Tone } from "@salesforce/ui";

export const orderStatusLabels: Record<ApiSchema<"OrderStatus">, { label: string; tone: Tone }> = {
  draft: { label: "Rascunho", tone: "neutral" },
  cancelled: { label: "Descartado", tone: "neutral" },
  queued: { label: "Na fila", tone: "info" },
  sent: { label: "Enviado", tone: "success" },
  rejected: { label: "Rejeitado", tone: "danger" },
  unknown: { label: "Situação desconhecida", tone: "warning" },
};

export const noPriceReasonLabels: Record<ApiSchema<"NoPriceReason">, string> = {
  no_resolved_table: "Cliente sem tabela de preço resolvida",
  no_effective_version: "Tabela de preço sem versão vigente",
  no_price_row: "Produto fora da tabela de preço",
};

export const priceContextSourceLabels: Record<ApiSchema<"PriceContext">["source"], string> = {
  customer: "tabela do cliente",
  fallback: "tabela alternativa da instalação",
  catalog_reference: "tabela de referência do catálogo",
  none: "nenhuma tabela",
};

/** Reference shown for an order: the ERP number once it exists there, otherwise the draft number. */
export function orderReference(order: Pick<ApiSchema<"OrderListItem">, "draftNumber" | "erpNumber">): string {
  return order.erpNumber === null ? `Rascunho nº ${order.draftNumber}` : `Pedido ${order.erpNumber}`;
}

/** pt-BR count with thousands separator. Counts are integers, never money. */
export function formatCount(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}
