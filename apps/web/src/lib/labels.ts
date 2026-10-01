import type { ApiSchema } from "@salesforce/contracts/client";
import type { Tone } from "@salesforce/ui";

/**
 * Order situation as Sales Force records it. These are Sales Force delivery states, NOT the ERP's own order status:
 * `sent` means the order was handed to the ERP, never that it was invoiced there (the ERP status is not carried by
 * the API yet). No "success" tone for anything that is not a confirmed final result.
 */
export const orderStatusLabels: Record<ApiSchema<"OrderStatus">, { label: string; tone: Tone }> = {
  draft: { label: "Rascunho", tone: "neutral" },
  cancelled: { label: "Descartado", tone: "neutral" },
  queued: { label: "Na fila de envio ao ERP", tone: "info" },
  sent: { label: "Enviado ao ERP", tone: "info" },
  rejected: { label: "Rejeitado no envio ao ERP", tone: "danger" },
  unknown: { label: "Situação desconhecida", tone: "warning" },
};

/** One sentence per situation: what it says, and what it does not say about the ERP. */
export const orderStatusHints: Record<ApiSchema<"OrderStatus">, string> = {
  draft: "Rascunho salvo no Sales Force. Ainda não foi enviado ao ERP.",
  cancelled: "Rascunho descartado no Sales Force. Nada foi enviado ao ERP.",
  queued: "Aguardando envio ao ERP. O pedido ainda não existe no ERP.",
  sent: "O ERP aceitou o pedido enviado pelo Sales Force. Isso não indica confirmação nem faturamento: a situação do pedido dentro do ERP não é acompanhada aqui.",
  rejected: "O envio ao ERP foi rejeitado. O pedido não foi criado no ERP.",
  unknown: "Não foi possível confirmar se o ERP recebeu o pedido. Confira no ERP antes de enviar novamente.",
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

/**
 * A draft whose customer can no longer be ordered for (derived by the server on every read; never a status of its own).
 * Shown next to the status, never instead of it.
 */
export const orderReviewLabel = "Requer revisão";

export const orderReviewReasons: Record<NonNullable<ApiSchema<"OrderListItem">["review"]>["customerBlock"], string> = {
  customer_unavailable: "O cliente deste rascunho não está mais disponível na sua carteira.",
  customer_inactive: "O cliente deste rascunho está inativo.",
  customer_blocked: "O cliente deste rascunho está bloqueado.",
  customer_without_seller: "O cliente deste rascunho está sem vendedor vinculado.",
};

/** Reference shown for an order: the ERP number once it exists there, otherwise the draft number. */
export function orderReference(order: Pick<ApiSchema<"OrderListItem">, "draftNumber" | "erpNumber">): string {
  return order.erpNumber === null ? `Rascunho nº ${order.draftNumber}` : `Pedido ${order.erpNumber}`;
}

/** pt-BR count with thousands separator. Counts are integers, never money. */
export function formatCount(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}
