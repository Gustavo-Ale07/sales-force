import { customerStateLabel } from "@salesforce/domain";
import type { CustomerListItem } from "./ports";

/** Shown wherever an order is attempted for a customer that has no Sankhya code yet (rule lives in mobile-db; text is the same). */
export const PENDING_CUSTOMER_ORDER_MESSAGE = "Este cliente ainda não tem código do Sankhya.";

/** Shown in the customer picker (order step 1) for a customer without a seller, who cannot be selected. */
export const NO_SELLER_ORDER_MESSAGE = "Cliente sem vendedor. Peça ao backoffice para atribuir.";

/** Shown on the customer sheet instead of a credit limit: nothing is invented for a customer that does not exist in the ERP yet. */
export const PENDING_CREDIT_NOTE = "Limite de crédito a definir pelo financeiro";

/**
 * "Sem vendedor" seal: a confirmed customer with no seller. A customer registered on this device has no seller until the ERP
 * answers, so it never carries the seal. Such a customer cannot be picked for an order (owner 2026-11-13).
 */
export function hasNoSeller(customer: { readonly sellerCode: number | null; readonly pending?: unknown }): boolean {
  return customer.sellerCode === null && customer.pending === undefined;
}

/** A customer registered here that has no Sankhya code yet: it cannot take orders. One that already has its code can. */
export function isUnconfirmedCustomer(customer: Pick<CustomerListItem, "pending">): boolean {
  return customer.pending !== undefined && customer.pending.state !== "confirmed";
}

/** A customer registered here that the ERP refused: the only unconfirmed customer that cannot take an order (owner 2026-11-26: the others queue the order behind the customer). */
export function isRefusedCustomer(customer: Pick<CustomerListItem, "pending">): boolean {
  return customer.pending !== undefined && customer.pending.state === "rejected";
}

/** The discreet pending-send indicator of a customer registered on this device; `null` for a customer that has its Sankhya code. */
export function describePendingBadge(pending: CustomerListItem["pending"]): string | null {
  if (pending === undefined || pending.state === "confirmed") return null;
  return pending.state === "rejected" ? "Recusado" : customerStateLabel("awaiting_send");
}

/** A line of the pending list the seller can discard from the row: refused, or held for a seller that cannot be chosen. */
export function canDiscardPending(pending: CustomerListItem["pending"]): boolean {
  return pending !== undefined && (pending.state === "rejected" || pending.needsSeller);
}
