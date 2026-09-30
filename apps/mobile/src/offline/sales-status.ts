import type { DraftRecord, DraftStatus, SalesGroup } from "@salesforce/mobile-db";

/**
 * "Enviados" means accepted by the Force backend — NOT delivered to the ERP (ERP submission is disabled), so no seller
 * text here says "ERP" or "Sankhya". Everything else, including a synced order with a change still queued, is "Não enviados".
 */
export function salesGroupOf(status: DraftStatus): SalesGroup {
  return status === "synced" ? "sent" : "unsent";
}

export type BadgeTone = "neutral" | "info" | "ok" | "warning" | "danger";
export interface SaleBadge {
  readonly label: string;
  readonly tone: BadgeTone;
}

type StatusView = Pick<DraftRecord, "status" | "remoteId">;

/** Compact list badge; one per real state of the sync engine. */
export function saleBadge({ status, remoteId }: StatusView): SaleBadge {
  switch (status) {
    case "local_only":
      return { label: "Rascunho", tone: "neutral" };
    case "pending_sync":
      return { label: remoteId === null ? "Aguardando envio" : "Alteração aguardando envio", tone: "warning" };
    case "syncing":
      return { label: "Sincronizando", tone: "info" };
    case "synced":
      return { label: "Sincronizado", tone: "ok" };
    case "sync_error":
      return { label: "Erro", tone: "danger" };
    case "conflict":
      return { label: "Conflito", tone: "danger" };
    case "needs_review":
      return { label: "Revisar preço", tone: "warning" };
  }
}

/** Where the order is and what the seller should do, in plain words (detail screen). */
export function saleExplanation(draft: Pick<DraftRecord, "status" | "remoteId" | "lastError">): string {
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
      return "Este pedido já está sincronizado com o Force.";
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
}

/**
 * What the seller may do with an order. A synced order is never edited or removed from here (no explicit rule for it
 * exists); a copy of it can be made. The database still refuses an unsafe delete on its own.
 */
export function saleActions(draft: Pick<DraftRecord, "status" | "remoteId">): SaleActions {
  const held = draft.remoteId !== null;
  return {
    continue: draft.status !== "synced",
    duplicate: true,
    delete: !held && draft.status !== "syncing",
    resend: draft.status === "sync_error" || draft.status === "pending_sync",
  };
}
