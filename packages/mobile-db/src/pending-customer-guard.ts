import type { SqlExecutor, SqlRow } from "./connection";

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
 * `customer_pending` when `code` is a local (negative) customer code or the ERP code of a customer that was confirmed but whose
 * real record the mirror has not delivered yet; otherwise `null`. Indicative only: the server stays authoritative (P-21).
 * Kept free of other module imports so both the order save and the order push can use it without an import cycle.
 */
export async function pendingCustomerBlockOf(db: SqlExecutor, code: number): Promise<"customer_pending" | null> {
  if (code < 0) return "customer_pending";
  const rows = await db.query<SqlRow>("SELECT 1 AS hit FROM pending_customer WHERE customer_code = ? LIMIT 1", [code]);
  return rows.length > 0 ? "customer_pending" : null;
}
