import type { SqlExecutor, SqlRow } from "./connection";

/** Why an order cannot use a customer the ERP has not confirmed yet; also the stored `last_error` of a held draft. */
export const PENDING_CUSTOMER_MESSAGE = "Este cliente ainda não tem código do Sankhya.";

/** Thrown when an order draft is saved for a customer that no longer exists on the device or was refused. */
export class PendingCustomerOrderError extends Error {
  constructor(message: string = PENDING_CUSTOMER_MESSAGE) {
    super(message);
    this.name = "PendingCustomerOrderError";
  }
}

/**
 * `customer_pending` when `code` is a local (negative) customer code, which belongs to a customer that is waiting for, or was
 * refused by, the ERP; otherwise `null`. A customer the ERP has confirmed carries its REAL code. A negative code must never reach
 * an order body or a sent command: the sync re-points it to the real code before the order leaves (owner 2026-11-26: an order may
 * be created for a customer still waiting, and stays queued behind the customer).
 * Free of other module imports so both the order save and the order push can use it without an import cycle.
 */
export function pendingCustomerBlockOf(code: number): "customer_pending" | null {
  return code < 0 ? "customer_pending" : null;
}

/** What the order queue does with an order whose customer is a local (negative) code. */
export type PendingCustomerOrderGate =
  /** The customer is queued, in flight or waiting for the ERP: the order stays queued behind it, untouched. */
  | { readonly kind: "wait" }
  /** The customer was refused (or discarded): the order needs the seller. `message` = the translated cause plus the way out. */
  | { readonly kind: "refused"; readonly message: string };

export const CUSTOMER_DISCARDED_ORDER_TEXT = "O cadastro deste cliente foi descartado. Escolha outro cliente para o pedido.";

/** The way out of a refusal, in the seller's words (the cause itself is the stored refusal text). */
export function customerRefusalOrderText(reason: string | null): string {
  const cause = reason === null || reason.trim() === "" ? "O Sankhya recusou o cadastro do cliente." : reason.trim();
  const way = /cpf\/cnpj/i.test(cause)
    ? "Procure esse cliente na lista e escolha-o neste pedido."
    : "Descarte o cadastro, cadastre o cliente de novo com os dados corretos e escolha-o neste pedido.";
  return `Cliente recusado. ${cause} ${way}`;
}

/** Reads the state of the pending customer a local code points to (owner-scoped). */
export async function pendingCustomerOrderGate(db: SqlExecutor, ownerAccountId: string, localCode: number): Promise<PendingCustomerOrderGate> {
  const rows = await db.query<SqlRow>("SELECT state, rejection_reason FROM pending_customer WHERE owner_account_id = ? AND seq = ?", [ownerAccountId, -localCode]);
  const row = rows[0];
  if (row === undefined) return { kind: "refused", message: CUSTOMER_DISCARDED_ORDER_TEXT };
  if (String(row.state) === "rejected") {
    return { kind: "refused", message: customerRefusalOrderText(row.rejection_reason === null || row.rejection_reason === undefined ? null : String(row.rejection_reason)) };
  }
  return { kind: "wait" };
}
