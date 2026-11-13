/** Why an order cannot use a customer the ERP has not confirmed yet; also the stored `last_error` of a held draft. */
export const PENDING_CUSTOMER_MESSAGE = "Este cliente ainda não foi confirmado pelo Sankhya.";

/** Thrown when an order draft is saved for a pending customer. */
export class PendingCustomerOrderError extends Error {
  constructor() {
    super(PENDING_CUSTOMER_MESSAGE);
    this.name = "PendingCustomerOrderError";
  }
}

/**
 * `customer_pending` when `code` is a local (negative) customer code, which belongs to a customer that is waiting for, or was
 * refused by, the ERP; otherwise `null`. A customer the ERP has confirmed carries its REAL code and may receive orders at once
 * (the server still decides eligibility, P-21). A negative code must never reach an order body or a sent command.
 * Free of other module imports so both the order save and the order push can use it without an import cycle.
 */
export function pendingCustomerBlockOf(code: number): "customer_pending" | null {
  return code < 0 ? "customer_pending" : null;
}
