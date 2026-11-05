import type { ApiSchema } from "@salesforce/contracts/client";
import { documentVocabulary, isDeliveryOverdue, type DocumentKind } from "@salesforce/domain";
import type { Tone } from "@salesforce/ui";

/**
 * Order situation as Sales Force records it. These are Sales Force delivery states, NOT Sankhya's own order status:
 * `sent` means the order was handed to Sankhya, never that it was invoiced there. No "success" tone for anything that is
 * not a confirmed final result. User text says "Sankhya", never "ERP" (D-L); texts follow decisions.md §3.16.
 * TODO(after Track B merges): the Sankhya-side status labels (D-E) come from `orderDeliveryLabel` in @salesforce/domain.
 */
export const orderStatusLabels: Record<ApiSchema<"OrderStatus">, { label: string; tone: Tone }> = {
  draft: { label: "não enviado", tone: "neutral" },
  awaiting_approval: { label: "Aguardando aprovação", tone: "warning" },
  approved: { label: "Aprovado", tone: "info" },
  approval_rejected: { label: "Reprovado na aprovação", tone: "danger" },
  queued: { label: "Enviando ao Sankhya…", tone: "info" },
  sent: { label: "Enviado ao Sankhya", tone: "info" },
  rejected: { label: "Falha no envio", tone: "danger" },
  unknown: { label: "Envio em verificação", tone: "warning" },
};

/**
 * D-AA: label, tone and hint of an order as the seller sees it. A delivery pending for more than 2 minutes reads
 * "Aguardando envio — será reenviado automaticamente"; the word "fila" never reaches the seller.
 */
export function orderStatusView(
  order: { status: ApiSchema<"OrderStatus">; erpNumber?: number | null; updatedAt?: string },
  now: number = Date.now(),
): { label: string; tone: Tone; hint: string } {
  const base = orderStatusLabels[order.status];
  const hint = orderStatusHints[order.status];
  if (order.status === "queued" && isDeliveryOverdue({ updatedAt: order.updatedAt, now })) {
    return {
      label: "Aguardando envio — será reenviado automaticamente",
      tone: "warning",
      hint: "O envio ao Sankhya está demorando. O Sales Force tenta de novo sozinho; não é preciso enviar outra vez.",
    };
  }
  return { ...base, hint };
}

/** One sentence per situation: what it says, and what it does not say about Sankhya. */
export const orderStatusHints: Record<ApiSchema<"OrderStatus">, string> = {
  draft: "Salvo no Sales Force. Ainda não foi enviado ao Sankhya.",
  awaiting_approval: "O desconto do pedido aguarda a decisão de um aprovador. Editar o pedido cancela a solicitação e o devolve a rascunho.",
  approved: "Desconto aprovado. Isso não significa que o pedido foi enviado ao Sankhya.",
  approval_rejected: "O aprovador reprovou o desconto. Edite o pedido para ajustar e enviar de novo.",
  queued: "O envio ao Sankhya está em andamento. O pedido ainda não existe no Sankhya.",
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
export function orderReference(order: Pick<ApiSchema<"OrderListItem">, "draftNumber" | "erpNumber">, kind: DocumentKind = "order"): string {
  return documentVocabulary(kind, order.erpNumber ?? order.draftNumber).title;
}

type ErpDelivery = NonNullable<ApiSchema<"OrderListItem">["erpDelivery"]>;

const deliveryCodeLabels: Record<string, string> = {
  environment_mismatch: "Configuração de ambiente divergente — avise o TI",
  environment_unbound: "Configuração de ambiente divergente — avise o TI",
  dataset_not_erp: "Pedido criado com dados de teste: não pode ser enviado ao Sankhya",
  send_disabled: "Envio ao Sankhya desligado",
  submission_disabled: "Envio ao Sankhya desligado",
  missing_company: "Empresa do pedido não configurada — avise o TI",
  missing_top: "TOP do pedido não definida",
  top_not_eligible: "TOP do pedido não permitida para envio",
  missing_stock_location: "Local de estoque não configurado — avise o TI",
  missing_negotiation_type: "Tipo de negociação não informado",
  no_items: "Pedido sem itens",
  missing_unit: "Item sem unidade",
  no_price: "Item sem preço",
  price_divergence: "O Sankhya gravou um preço diferente do enviado",
  discount_divergence: "O Sankhya gravou um desconto diferente do enviado",
  item_mismatch: "Os itens gravados no Sankhya diferem dos enviados",
  order_not_deliverable: "O pedido não estava em situação de envio",
};

/** K3: why the last delivery of a rejected order failed, from the stable class and code only (never the stored text). */
export function deliveryErrorText(delivery: ErpDelivery | null | undefined): string | null {
  if (!delivery) return null;
  const byCode = delivery.errorCode ? deliveryCodeLabels[delivery.errorCode] : undefined;
  if (byCode) return byCode;
  if (delivery.errorClass === "validation") return "O Sankhya ou o Sales Force recusou os dados do pedido";
  return `Falha no envio (${delivery.errorClass}${delivery.errorCode ? ` / ${delivery.errorCode}` : ""})`;
}

type ErpStatus = NonNullable<ApiSchema<"OrderListItem">["erpStatus"]>;

/** Sankhya status as read by the worker (P2): the label, plus the pending release events when the detail carries them. */
export function erpStatusText(status: ErpStatus): { label: string; detail: string | null } {
  const events = status.releaseEvents ?? [];
  if (events.length === 0) return { label: status.label, detail: null };
  // No configured name for an event: say "evento N" instead of inventing one.
  return { label: status.label, detail: `pendente: ${events.map((event) => event.label ?? `evento ${event.code}`).join(", ")}` };
}

/** pt-BR count with thousands separator. Counts are integers, never money. */
export function formatCount(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}
