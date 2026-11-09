import type { ApiSchema } from "@salesforce/contracts/client";
import type { DocumentKind } from "@salesforce/domain";
import { deliveryErrorText, erpStatusText } from "./labels";

type OrderDetail = ApiSchema<"OrderDetail">;

export type SendPhase = "sending" | "confirmed" | "released_pending" | "simulated" | "failed" | "verifying" | "overdue";

export interface SendOutcome {
  readonly phase: SendPhase;
  readonly title: string;
  readonly detail: string | null;
  /** The dialog stops polling and may be closed. */
  readonly final: boolean;
}

/** How long the confirm dialog waits for the worker before it says the delivery is waiting (D-AB B2). */
export const SEND_WAIT_MS = 20_000;
export const SEND_POLL_MS = 2_000;

/**
 * D-AB B2: what the seller reads in the "Enviando ao Sankhya…" dialog, from the order as the server returns it.
 * The word "fila" never appears. `timedOut` is true once SEND_WAIT_MS passed without a final state.
 */
export function sendOutcomeOf(order: OrderDetail, kind: DocumentKind, timedOut: boolean): SendOutcome {
  const noun = kind === "quote" ? "Orçamento" : "Pedido";
  if (order.status === "sent" && order.erpNumber !== null && order.erpNumber !== undefined) {
    const status = order.erpStatus ?? null;
    const text = status ? erpStatusText(status) : null;
    if (text?.detail) {
      return { phase: "released_pending", title: `${noun} nº ${order.erpNumber} — aguardando liberação`, detail: text.detail, final: true };
    }
    return { phase: "confirmed", title: `Enviado ao Sankhya — nº ${order.erpNumber}. A conferência é feita pela Plac.`, detail: text?.label ?? null, final: true };
  }
  if (order.status === "rejected") {
    const reason = deliveryErrorText(order.erpDelivery);
    return { phase: "failed", title: reason ? `Falha no envio: ${reason}` : "Falha no envio", detail: null, final: true };
  }
  if (order.status === "draft" && order.dryRun) {
    return {
      phase: "simulated",
      title: "Simulado — não enviado",
      detail: "Nada foi criado no Sankhya. Para enviar de verdade, confirme de novo quando o envio estiver ligado.",
      final: true,
    };
  }
  if (order.status === "unknown") {
    return {
      phase: "verifying",
      title: "Verificando envio…",
      detail: "O Sankhya ainda não respondeu. Nada será duplicado: o Force PLAC confere antes de reenviar.",
      final: true,
    };
  }
  if (timedOut) {
    return {
      phase: "overdue",
      title: "Aguardando envio — será reenviado automaticamente",
      detail: "Pode fechar esta janela; o resultado aparece na lista de Vendas.",
      final: true,
    };
  }
  return { phase: "sending", title: "Enviando ao Sankhya…", detail: null, final: false };
}
