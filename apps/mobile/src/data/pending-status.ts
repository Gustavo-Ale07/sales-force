import type { CustomerListItem } from "./ports";

/** Shown wherever an order is attempted for a customer the ERP has not confirmed (rule lives in mobile-db; text is the same). */
export const PENDING_CUSTOMER_ORDER_MESSAGE = "Este cliente ainda não foi confirmado pelo Sankhya.";

/** Shown on the customer sheet instead of a credit limit: nothing is invented for a customer that does not exist in the ERP yet. */
export const PENDING_CREDIT_NOTE = "Limite de crédito a definir pelo financeiro";

/** Seller-facing badge of a customer created on this device; `null` for a normal (mirrored) customer. */
export function describePendingBadge(pending: CustomerListItem["pending"]): string | null {
  if (pending === undefined) return null;
  switch (pending.state) {
    case "queued":
    case "sending":
      return "Aguardando envio ao Sankhya";
    case "awaiting_erp":
      return "Aguardando confirmação";
    case "confirmed":
      return "Confirmado no Sankhya — sincronizando";
    case "rejected":
      return `Não aceito: ${pending.rejectionReason ?? "o Sankhya recusou o cadastro."}`;
  }
}
