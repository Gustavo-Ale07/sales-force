import { erpStageViewOf } from "./erp-stage";
import { CUSTOMER_UNAVAILABLE_MESSAGE, LEGACY_CUSTOMER_UNAVAILABLE_MESSAGE, isCustomerUnavailableMessage, PRODUCT_BLOCK_MESSAGES, type DraftRecord, isConfirmedLocked, draftErpNumber, type SalesGroup } from "@salesforce/mobile-db";

/**
 * "Enviados" means accepted by the Force backend — NOT delivered to, confirmed by or invoiced in Sankhya. The device carries no
 * Sankhya stage, so no label here claims one (never "sincronizado com o ERP", "confirmado" or "faturado"). Everything else,
 * including a synced order with a change still queued, is "Não enviados".
 */
export function salesGroupOf(view: Pick<DraftRecord, "status"> & Partial<Pick<DraftRecord, "sendState" | "erpStage">>): SalesGroup {
  // A saved order the Force backend already holds as a draft is still "Não enviados": it never went to Sankhya.
  return view.status === "synced" && (view.sendState === "submitted" || (view.erpStage ?? null) !== null) ? "sent" : "unsent";
}

export type BadgeTone = "neutral" | "info" | "ok" | "warning" | "danger";
export interface SaleBadge {
  readonly label: string;
  readonly tone: BadgeTone;
}

type SendView = Partial<Pick<DraftRecord, "sendState" | "sendCode">>;
type StatusView = Pick<DraftRecord, "status" | "remoteId"> & Partial<Pick<DraftRecord, "lastError" | "erpStage">> & SendView;

/** The server's stage replaces the send-phase badge once the order is in Sankhya; waiting, refused and discount-approval states stay (they happen before Sankhya). */
const STAGE_OVERRIDES_PHASE: readonly (SendPhase | null)[] = [null, "in_sankhya", "verifying", "approved"];

/**
 * SEAM for the stage timeline (not built): the seller-facing state of the "send to Sankhya" request, derived only from the persisted
 * send flag and the server order status it stored. `null` = the seller never asked to send (the order is only saved).
 * "Enviado ao Sankhya" appears only when the SERVER said queued or sent; unknown/awaiting approval have their own wording.
 */
export type SendPhase = "waiting" | "refused" | "rejected" | "in_sankhya" | "verifying" | "awaiting_approval" | "approval_rejected" | "approved";

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
    case "rejected":
      return "rejected";
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

/** The Sankhya stage to show for this order (badge and detail card), or `null` = keep the previous labels. */
export function activeStageView(view: Pick<DraftRecord, "status"> & Partial<Pick<DraftRecord, "erpStage">> & SendView): ReturnType<typeof erpStageViewOf> {
  if (view.status !== "synced" || !STAGE_OVERRIDES_PHASE.includes(sendPhaseOf(view)) || isCustomerUnavailable(view) || isProductBlocked(view)) return null;
  return erpStageViewOf(view.erpStage);
}

/** Compact list badge; one per real state of the sync engine. */
export function saleBadge(view: StatusView): SaleBadge {
  const { status } = view;
  if (isCustomerUnavailable(view)) return { label: "Cliente indisponível", tone: "warning" };
  if (isProductBlocked(view)) return { label: "Produto indisponível", tone: "warning" };
  // A confirmed order waiting for its create/replace to reach the server is already "Aguardando envio" (status pending_sync).
  const phase = status === "synced" || view.sendState === "requested" ? sendPhaseOf(view) : null;
  const stage = status === "synced" && STAGE_OVERRIDES_PHASE.includes(phase) ? erpStageViewOf(view.erpStage) : null;
  if (stage !== null) return { label: stage.label, tone: stage.tone };
  if (phase !== null) {
    switch (phase) {
      case "waiting":
        return { label: "Aguardando envio", tone: "warning" };
      case "rejected":
      case "refused":
        return { label: "Precisa de correção", tone: "danger" };
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
    // No send request: saved only on the device (even if the Force backend already holds its draft copy); it goes to Sankhya only after "Confirmar".
    case "local_only":
    case "pending_sync":
    case "syncing":
    case "synced":
      return { label: "Salvo no aparelho", tone: "neutral" };
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
  const phase = draft.status === "synced" || draft.sendState === "requested" ? sendPhaseOf(draft) : null;
  if (phase !== null) {
    switch (phase) {
      case "waiting":
        return "Salvo neste aparelho. Será enviado ao Sankhya assim que possível.";
      case "rejected":
        return "Precisa de correção. Edite o pedido e confirme de novo.";
      case "refused":
        return `Precisa de correção. ${draft.sendError ?? ""} Corrija o que for preciso e confirme de novo.`.replace(/\s+/g, " ").trim();
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
    case "pending_sync":
    case "syncing":
    case "synced":
      return "Salvo neste aparelho. Ainda não foi enviado ao Sankhya.";
    case "sync_error":
      return `Não foi possível enviar este pedido. ${draft.lastError ?? ""} Corrija o que for preciso ou tente enviar novamente.`.replace(/\s+/g, " ").trim();
    case "conflict":
      return "Este pedido foi alterado em outro lugar. Escolha qual versão manter; nada foi sobrescrito.";
    case "needs_review":
      return "Os preços mudaram desde a última atualização. Revise os novos preços antes de enviar.";
  }
}

/** The explanation only when the seller has something to fix or decide (blocked, refused, error, conflict, price review, rejected discount); `null` for plain progress states. */
export function saleActionableExplanation(draft: Parameters<typeof saleExplanation>[0]): string | null {
  const phase = draft.status === "synced" || draft.sendState === "requested" ? sendPhaseOf(draft) : null;
  const actionable =
    isCustomerUnavailable(draft) ||
    isProductBlocked(draft) ||
    draft.status === "sync_error" ||
    draft.status === "conflict" ||
    draft.status === "needs_review" ||
    phase === "refused" ||
    phase === "rejected" ||
    phase === "approval_rejected";
  return actionable ? saleExplanation(draft) : null;
}

export interface SaleActions {
  readonly continue: boolean;
  readonly duplicate: boolean;
  /** Delete the order from this device. Only for an order the Force backend has never received. */
  readonly delete: boolean;
  readonly resend: boolean;
  /** "Confirmar" for an order never confirmed, "Tentar de novo" for one the server refused. */
  readonly send: boolean;
}

/**
 * What the seller may do with an order. A synced order is never edited or removed from here (no explicit rule for it
 * exists); a copy of it can be made. The database still refuses an unsafe delete on its own.
 */
export function saleActions(draft: Pick<DraftRecord, "status" | "remoteId"> & Partial<Pick<DraftRecord, "lastError" | "erpNumber" | "erpStage">> & SendView): SaleActions {
  const held = draft.remoteId !== null;
  // A sent order (queued/sent/unknown on the server) is read-only: no edit, no delete, no second send. A refused send, or an order
  // waiting for / rejected in the discount approval, goes back to the seller for editing. A plain saved order can be sent from the detail.
  const hasErpNumber = draftErpNumber({ erpNumber: draft.erpNumber ?? null, erpStage: draft.erpStage ?? null }) !== null;
  // "rejected" (Precisa de correção) is editable only while it has no Sankhya number (SNK-4).
  const sentToErp = draft.sendState === "submitted" && sendPhaseOf(draft) !== "awaiting_approval" && sendPhaseOf(draft) !== "approval_rejected" && !(sendPhaseOf(draft) === "rejected" && !hasErpNumber);
  // Editable: "Salvo no aparelho" and "Precisa de correção" (and held orders). Blocked: "Aguardando envio" and "Enviado ao Sankhya".
  const confirmedLocked = isConfirmedLocked({ sendState: draft.sendState ?? null, status: draft.status });
  return {
    continue: !sentToErp && !confirmedLocked,
    send: (draft.status === "synced" || draft.status === "pending_sync" || draft.status === "local_only") && !isCustomerUnavailable(draft) && !isProductBlocked(draft) && (draft.sendState === undefined || draft.sendState === null || draft.sendState === "refused"),
    duplicate: true,
    delete: !held && draft.status !== "syncing",
    // A draft held for an unavailable customer is never offered for resending: sending stays blocked until it is reviewed.
    resend: !isCustomerUnavailable(draft) && !isProductBlocked(draft) && (draft.status === "sync_error" || draft.sendState === "requested"),
  };
}
