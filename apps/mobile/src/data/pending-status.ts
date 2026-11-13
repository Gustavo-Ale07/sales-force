import type { CustomerListItem } from "./ports";

/** Shown wherever an order is attempted for a customer the ERP has not confirmed (rule lives in mobile-db; text is the same). */
export const PENDING_CUSTOMER_ORDER_MESSAGE = "Este cliente ainda não foi confirmado pelo Sankhya.";

/** Shown on the customer sheet instead of a credit limit: nothing is invented for a customer that does not exist in the ERP yet. */
export const PENDING_CREDIT_NOTE = "Limite de crédito a definir pelo financeiro";

/** A customer created here that cannot take orders yet (waiting, queued or refused). One the ERP confirmed already can. */
/**
 * "Sem vendedor" seal: a confirmed customer with no seller. A customer created on this device has no seller until the ERP
 * answers, so it never carries the seal. Display only; whether such a customer may be ordered for is an open owner question.
 */
export function hasNoSeller(customer: { readonly sellerCode: number | null; readonly pending?: unknown }): boolean {
  return customer.sellerCode === null && customer.pending === undefined;
}

export function isUnconfirmedCustomer(customer: Pick<CustomerListItem, "pending">): boolean {
  return customer.pending !== undefined && customer.pending.state !== "confirmed";
}

/** Seller-facing badge of a customer created on this device; `null` for a normal (mirrored) customer. */
export function describePendingBadge(pending: CustomerListItem["pending"]): string | null {
  if (pending === undefined) return null;
  if (pending.waitingForRelease === true) return "Cadastro de cliente ainda não liberado, vamos tentar de novo";
  switch (pending.state) {
    case "queued":
    case "sending":
      return "Aguardando envio ao Sankhya";
    case "awaiting_erp":
      return "Aguardando confirmação";
    case "confirmed":
      return "Confirmado no Sankhya — carregando dados";
    case "rejected":
      return `Não aceito: ${pending.rejectionReason ?? "o Sankhya recusou o cadastro."}`;
  }
}
