import type { ApiSchema } from "@salesforce/contracts/client";
import { documentVocabulary, isDeliveryOverdue, type DocumentKind } from "@salesforce/domain";
import type { Tone } from "@salesforce/ui";

/**
 * Order situation as Sales Force records it. These are Sales Force delivery states, NOT Sankhya's own order status:
 * `sent` means the order was handed to Sankhya, never that it was invoiced there. Tones: success (green) only for `sent`,
 * the confirmed delivery; in progress (queued, unknown, approved) is info (blue); failures are danger (red); waiting that
 * needs action or is long (awaiting approval, overdue delivery) is warning (amber). User text says "Sankhya", never "ERP" (D-L); texts follow decisions.md §3.16.
 * TODO(after Track B merges): the Sankhya-side status labels (D-E) come from `orderDeliveryLabel` in @salesforce/domain.
 */
export const orderStatusLabels: Record<ApiSchema<"OrderStatus">, { label: string; tone: Tone }> = {
  draft: { label: "não enviado", tone: "neutral" },
  awaiting_approval: { label: "Aguardando aprovação", tone: "warning" },
  approved: { label: "Aprovado", tone: "info" },
  approval_rejected: { label: "Reprovado na aprovação", tone: "danger" },
  queued: { label: "Enviando ao Sankhya…", tone: "info" },
  sent: { label: "Enviado ao Sankhya", tone: "success" },
  rejected: { label: "Falha no envio", tone: "danger" },
  unknown: { label: "Verificando envio…", tone: "info" },
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
  sent: "A nota já existe no Sankhya. A liberação e a conferência são feitas pela Plac dentro do Sankhya; este status não indica faturamento.",
  rejected: "O envio ao Sankhya falhou. Veja o motivo no pedido: se a nota já existe no Sankhya, ela não é reenviada.",
  unknown: "Estamos verificando o envio com o Sankhya. Isso se resolve sozinho em instantes.",
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
  missing_freight_type: "Frete não informado",
  no_items: "Pedido sem itens",
  missing_unit: "Item sem unidade",
  no_price: "Item sem preço",
  price_divergence: "O preço mudou depois do pedido, ou o Sankhya gravou um preço diferente do enviado. Refaça o pedido",
  discount_divergence: "O Sankhya gravou um desconto diferente do enviado",
  item_mismatch: "Os itens gravados no Sankhya diferem dos enviados",
  ipi_divergence: "O Sankhya calculou um IPI diferente da estimativa do Force",
  total_divergence: "O total da nota no Sankhya difere do total do Force (itens líquidos + IPI)",
  order_not_deliverable: "O pedido não estava em situação de envio",
  include_timeout_unconfirmed: "O Sankhya não confirmou o recebimento a tempo. Reenvie: o Force PLAC confere antes de criar o pedido",
  ambiguous_origin: "Há mais de uma nota com este pedido no Sankhya. Peça à TI para conferir.",
};

const divergenceCodes = new Set(["price_divergence", "discount_divergence", "item_mismatch", "ipi_divergence", "total_divergence"]);

/** D-AK: the ERP note exists with other values than the order; the Force does not resend it (the server answers 409 too). */
export function erpNoteDiverged(order: { erpNumber?: number | null; erpDelivery?: { errorCode?: string | null } | null } | null | undefined): boolean {
  const code = order?.erpDelivery?.errorCode;
  return order?.erpNumber != null && code != null && divergenceCodes.has(code);
}

/** Seller text for a diverged note. */
export function erpNoteDivergedText(erpNumber: number): string {
  return `A nota nº ${erpNumber} já existe no Sankhya com valores diferentes do pedido. Peça à TI para conferir; o Force não reenvia.`;
}

/** K3: why the last delivery of a rejected order failed, from the stable class and code only (never the stored text). */
export function deliveryErrorText(delivery: ErpDelivery | null | undefined): string | null {
  if (!delivery) return null;
  const byCode = delivery.errorCode ? deliveryCodeLabels[delivery.errorCode] : undefined;
  if (byCode) return byCode;
  if (delivery.errorCode === "erp_refused_order") return delivery.message ? `O Sankhya recusou o pedido: ${delivery.message}` : "O Sankhya recusou o pedido";
  if (delivery.errorClass === "validation") return "O Sankhya ou o Force recusou os dados do pedido";
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

type ErpRelease = NonNullable<ApiSchema<"OrderListItem">["erpRelease"]>;
type ErpReleaseState = ErpRelease["state"];

/** Release (liberação) state beside the Sankhya status. "Aguardando liberação" is the normal state of a sent order: amber, calm. */
export const erpReleaseLabels: Record<ErpReleaseState, { label: string; tone: Tone }> = {
  awaiting: { label: "Aguardando liberação", tone: "warning" },
  released: { label: "Liberado", tone: "success" },
  denied: { label: "Negado", tone: "danger" },
};

/** Reassurance shown on the order detail; "awaiting" is not an alarm. */
export const erpReleaseMessages: Record<ErpReleaseState, string> = {
  awaiting: "Enviado ao Sankhya, aguardando liberação.",
  released: "Liberado no Sankhya.",
  denied: "A liberação foi negada no Sankhya.",
};

type ErpBilling = NonNullable<ApiSchema<"OrderListItem">["erpBilling"]>;
type ErpBillingState = ErpBilling["state"];

/**
 * Billing (faturamento) state of an order already in the ERP. One table for list and detail; colour is never the only
 * signal (the label always shows). Cancelled gray, denied red, awaiting release amber, invoiced green, awaiting billing
 * light blue, sent-without-confirmation neutral.
 */
export const erpBillingLabels: Record<ErpBillingState, { label: string; tone: Tone; hint: string }> = {
  cancelled: { label: "Cancelado", tone: "neutral", hint: "O pedido foi cancelado no Sankhya." },
  denied: { label: "Negado", tone: "danger", hint: "A liberação foi negada no Sankhya." },
  awaiting_release: { label: "Aguardando liberação", tone: "warning", hint: "Enviado ao Sankhya, aguardando liberação." },
  invoiced: { label: "Faturado", tone: "success", hint: "O pedido foi faturado no Sankhya." },
  awaiting_billing: { label: "Aguardando faturamento", tone: "info", hint: "Liberado e confirmado; aguardando o faturamento." },
  sent: { label: "Enviado (sem confirmação)", tone: "neutral", hint: "Enviado ao Sankhya, ainda sem confirmação da nota." },
};

/** "Faturado em 09/11/2026" for the detail; the date arrives as YYYY-MM-DD. */
export function erpBillingText(billing: ErpBilling): string {
  const base = erpBillingLabels[billing.state].hint;
  const match = billing.invoicedAt ? /^(\d{4})-(\d{2})-(\d{2})/.exec(billing.invoicedAt) : null;
  const date = match ? `${match[3]}/${match[2]}/${match[1]}` : null;
  if (billing.state === "invoiced") return `Faturado${date ? ` em ${date}` : ""}${billing.nfeAuthorized ? " · NF-e autorizada" : ""}.`;
  return base;
}

/** Per-item billing line for the detail: invoiced, and the cut quantity when something was not delivered. */
export function erpBillingItemText(item: NonNullable<ErpBilling["items"]>[number]): string {
  const cut = item.cutQuantity !== "0" && item.cutQuantity !== "" ? ` · cortado ${item.cutQuantity}` : "";
  return `faturado ${item.invoicedQuantity}${cut}`;
}

/** One line per release event, with the event description (or "evento N" when the ERP gave none) and its state. */
export function erpReleaseEventText(event: NonNullable<ErpRelease["events"]>[number]): string {
  return `${event.label ?? `evento ${event.code}`}: ${erpReleaseLabels[event.state].label.toLowerCase()}`;
}

/** pt-BR count with thousands separator. Counts are integers, never money. */
export function formatCount(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}
