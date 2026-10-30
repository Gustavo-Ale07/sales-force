import type { ApiSchema } from "@salesforce/contracts/client";
import type { Tone } from "@salesforce/ui";

/**
 * Order situation as Sales Force records it. These are Sales Force delivery states, NOT Sankhya's own order status:
 * `sent` means the order was handed to Sankhya, never that it was invoiced there. No "success" tone for anything that is
 * not a confirmed final result. User text says "Sankhya", never "ERP" (D-L); texts follow decisions.md §3.16.
 * TODO(after Track B merges): the Sankhya-side status labels (D-E) come from `orderDeliveryLabel` in @salesforce/domain.
 */
export const orderStatusLabels: Record<ApiSchema<"OrderStatus">, { label: string; tone: Tone }> = {
  draft: { label: "Rascunho", tone: "neutral" },
  awaiting_approval: { label: "Aguardando aprovação", tone: "warning" },
  approved: { label: "Aprovado", tone: "info" },
  approval_rejected: { label: "Reprovado na aprovação", tone: "danger" },
  cancelled: { label: "Descartado", tone: "neutral" },
  queued: { label: "Na fila para o Sankhya", tone: "info" },
  sent: { label: "Enviado ao Sankhya", tone: "info" },
  rejected: { label: "Falha no envio", tone: "danger" },
  unknown: { label: "Envio em verificação", tone: "warning" },
};

/** One sentence per situation: what it says, and what it does not say about Sankhya. */
export const orderStatusHints: Record<ApiSchema<"OrderStatus">, string> = {
  draft: "Rascunho salvo no Sales Force. Ainda não foi enviado ao Sankhya.",
  awaiting_approval: "O desconto do pedido aguarda a decisão de um aprovador. Editar o pedido cancela a solicitação e o devolve a rascunho.",
  approved: "Desconto aprovado. Isso não significa que o pedido foi enviado ao Sankhya.",
  approval_rejected: "O aprovador reprovou o desconto. Edite o pedido para ajustar e enviar de novo.",
  cancelled: "Rascunho descartado no Sales Force. Nada foi enviado ao Sankhya.",
  queued: "Na fila para o Sankhya. O pedido ainda não existe no Sankhya.",
  sent: "O Sankhya recebeu o pedido enviado pelo Sales Force. Isso não indica confirmação nem faturamento.",
  rejected: "O envio ao Sankhya falhou. O pedido não foi criado no Sankhya; ele pode ser reenviado depois.",
  unknown: "Não foi possível confirmar se o Sankhya recebeu o pedido. Confira no Sankhya antes de enviar novamente.",
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

/** Reference shown for an order: the Sankhya number once it exists there, otherwise the draft number. */
export function orderReference(order: Pick<ApiSchema<"OrderListItem">, "draftNumber" | "erpNumber">): string {
  return order.erpNumber === null ? `Rascunho nº ${order.draftNumber}` : `Pedido ${order.erpNumber}`;
}

/** pt-BR count with thousands separator. Counts are integers, never money. */
export function formatCount(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}
