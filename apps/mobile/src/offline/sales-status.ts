import { CUSTOMER_UNAVAILABLE_MESSAGE, LEGACY_CUSTOMER_UNAVAILABLE_MESSAGE, isCustomerUnavailableMessage, PRODUCT_BLOCK_MESSAGES, type DraftRecord, type DraftStatus, type SalesGroup } from "@salesforce/mobile-db";

/**
 * "Enviados" means accepted by the Force backend — NOT delivered to, confirmed by or invoiced in Sankhya. The device carries no
 * Sankhya stage, so no label here claims one (never "sincronizado com o ERP", "confirmado" or "faturado"). Everything else,
 * including a synced order with a change still queued, is "Não enviados".
 */
export function salesGroupOf(status: DraftStatus): SalesGroup {
  return status === "synced" ? "sent" : "unsent";
}

export type BadgeTone = "neutral" | "info" | "ok" | "warning" | "danger";
export interface SaleBadge {
  readonly label: string;
  readonly tone: BadgeTone;
}

type SendView = Partial<Pick<DraftRecord, "sendState" | "sendCode">>;
type StatusView = Pick<DraftRecord, "status" | "remoteId"> & Partial<Pick<DraftRecord, "lastError">> & SendView;

/**
 * SEAM for the stage timeline (not built): the seller-facing state of the "send to Sankhya" request, derived only from the persisted
 * send flag and the server order status it stored. `null` = the seller never asked to send (the order is only saved).
 * "Enviado ao Sankhya" appears only when the SERVER said queued or sent; unknown/awaiting approval have their own wording.
 */
export type SendPhase = "waiting" | "refused" | "in_sankhya" | "verifying" | "awaiting_approval" | "approval_rejected" | "approved";

export function sendPhaseOf(view: SendView): SendPhase | null {
  if (view.sendState === "requested") return "waiting";
  if (view.sendState === "refused") return "refused";
  if (view.sendState !== "submitted") return null;
  switch (view.sendCode) {
    case "queued":
    case "sent":
      return "in_sankhya";
    case "unknown":
      return "verifying";
    case "awaiting_approval":
      return "awaiting_approval";
    case "approval_rejected":
      return "approval_rejected";
    case "approved":
      return "approved";
    default:
      return "verifying";
  }
}

/** A draft held back because its customer is no longer available (local guard or the server answer `customer_ineligible`). */
export function isCustomerUnavailable(draft: Pick<DraftRecord, "status"> & Partial<Pick<DraftRecord, "lastError">>): boolean {
  return draft.status === "sync_error" && isCustomerUnavailableMessage(draft.lastError ?? null) && !isProductBlocked(draft);
}

/** A draft held because a line lost its mobility or its price after a sync (local guard; the server also refuses on send). */
export function isProductBlocked(draft: Pick<DraftRecord, "status"> & Partial<Pick<DraftRecord, "lastError">>): boolean {
  return draft.status === "sync_error" && Object.values(PRODUCT_BLOCK_MESSAGES).includes(draft.lastError ?? "");
}

/** Compact list badge; one per real state of the sync engine. */
export function saleBadge(view: StatusView): SaleBadge {
  const { status, remoteId } = view;
  if (isCustomerUnavailable(view)) return { label: "Cliente indisponível", tone: "warning" };
  if (isProductBlocked(view)) return { label: "Produto indisponível", tone: "warning" };
  const phase = status === "synced" ? sendPhaseOf(view) : null;
  if (phase !== null) {
    switch (phase) {
      case "waiting":
        return { label: "Aguardando envio", tone: "warning" };
      case "refused":
        return { label: "Envio recusado", tone: "danger" };
      case "in_sankhya":
        return { label: "Enviado ao Sankhya", tone: "ok" };
      case "verifying":
        return { label: "Conferindo envio", tone: "info" };
      case "awaiting_approval":
        return { label: "Aguardando aprovação", tone: "warning" };
      case "approval_rejected":
        return { label: "Desconto reprovado", tone: "danger" };
      case "approved":
        return { label: "Desconto aprovado", tone: "info" };
    }
  }
  switch (status) {
    case "local_only":
      return { label: "Somente no aparelho", tone: "neutral" };
    case "pending_sync":
      return { label: remoteId === null ? "Aguardando envio" : "Alteração aguardando envio", tone: "warning" };
    case "syncing":
      return { label: "Sincronizando", tone: "info" };
    case "synced":
      return { label: "Enviado ao Force", tone: "ok" };
    case "sync_error":
      return { label: "Erro", tone: "danger" };
    case "conflict":
      return { label: "Conflito", tone: "danger" };
    case "needs_review":
      return { label: "Revisar preço", tone: "warning" };
  }
}

/** Where the order is and what the seller should do, in plain words (detail screen). */
export function saleExplanation(draft: Pick<DraftRecord, "status" | "remoteId" | "lastError"> & SendView & Partial<Pick<DraftRecord, "sendError">>): string {
  if (isCustomerUnavailable(draft)) {
    // The stored text is the cause itself (inativo, bloqueado, sem vendedor…); an old generic marker keeps the old wording.
    const cause = (draft.lastError === CUSTOMER_UNAVAILABLE_MESSAGE || draft.lastError === LEGACY_CUSTOMER_UNAVAILABLE_MESSAGE) ? "O cadastro deste cliente mudou (inativo ou bloqueado)." : draft.lastError;
    return `Cliente indisponível — revise o pedido. ${cause} O pedido não será enviado enquanto isso não for resolvido. Nada foi alterado ou apagado.`;
  }
  if (isProductBlocked(draft)) {
    return `${draft.lastError} — revise os itens do pedido. O pedido não será enviado enquanto isso não for resolvido. Nada foi alterado ou apagado.`;
  }
  const phase = draft.status === "synced" ? sendPhaseOf(draft) : null;
  if (phase !== null) {
    switch (phase) {
      case "waiting":
        return "Este pedido está salvo no Force e será enviado ao Sankhya assim que houver conexão.";
      case "refused":
        return `O envio ao Sankhya foi recusado. ${draft.sendError ?? ""} Revise o pedido e envie de novo.`.replace(/\s+/g, " ").trim();
      case "in_sankhya":
        return "Este pedido foi enviado ao Sankhya.";
      case "verifying":
        return "O envio ao Sankhya está sendo conferido. Não envie de novo.";
      case "awaiting_approval":
        return "O desconto deste pedido espera a aprovação de um gestor.";
      case "approval_rejected":
        return "O desconto foi reprovado. Edite o pedido antes de enviá-lo de novo.";
      case "approved":
        return "O desconto foi aprovado. O pedido segue para o Sankhya.";
    }
  }
  switch (draft.status) {
    case "local_only":
      return "Este pedido está salvo somente neste aparelho.";
    case "pending_sync":
      return draft.remoteId === null
        ? "Este pedido está salvo neste aparelho e será enviado ao Force quando houver conexão."
        : "As alterações deste pedido estão salvas neste aparelho e serão enviadas quando houver conexão.";
    case "syncing":
      return "Enviando este pedido ao Force...";
    case "synced":
      return "Este pedido foi enviado ao Force. O andamento no Sankhya ainda não é acompanhado neste aplicativo.";
    case "sync_error":
      return `Não foi possível enviar este pedido. ${draft.lastError ?? ""} Corrija o que for preciso ou tente enviar novamente.`.replace(/\s+/g, " ").trim();
    case "conflict":
      return "Este pedido foi alterado em outro lugar. Escolha qual versão manter; nada foi sobrescrito.";
    case "needs_review":
      return "Os preços mudaram desde a última atualização. Revise os novos preços antes de enviar.";
  }
}

export interface SaleActions {
  readonly continue: boolean;
  readonly duplicate: boolean;
  /** Delete the order from this device. Only for an order the Force backend has never received. */
  readonly delete: boolean;
  readonly resend: boolean;
  /** "Enviar pedido" for an order that is only saved on the Force (never asked to send, or the send was refused: then "Reenviar"). */
  readonly send: boolean;
}

/**
 * What the seller may do with an order. A synced order is never edited or removed from here (no explicit rule for it
 * exists); a copy of it can be made. The database still refuses an unsafe delete on its own.
 */
export function saleActions(draft: Pick<DraftRecord, "status" | "remoteId"> & Partial<Pick<DraftRecord, "lastError">> & SendView): SaleActions {
  const held = draft.remoteId !== null;
  // A sent order (queued/sent/unknown on the server) is read-only: no edit, no delete, no second send. A refused send, or an order
  // waiting for / rejected in the discount approval, goes back to the seller for editing. A plain saved order can be sent from the detail.
  const sentToErp = draft.sendState === "submitted" && sendPhaseOf(draft) !== "awaiting_approval" && sendPhaseOf(draft) !== "approval_rejected";
  const editableSynced = draft.sendState === "refused" || (draft.sendState === "submitted" && !sentToErp);
  return {
    continue: draft.status !== "synced" ? !sentToErp : editableSynced,
    send: draft.status === "synced" && held && (draft.sendState === undefined || draft.sendState === null || draft.sendState === "refused"),
    duplicate: true,
    delete: !held && draft.status !== "syncing",
    // A draft held for an unavailable customer is never offered for resending: sending stays blocked until it is reviewed.
    resend: !isCustomerUnavailable(draft) && !isProductBlocked(draft) && (draft.status === "sync_error" || draft.status === "pending_sync"),
  };
}
