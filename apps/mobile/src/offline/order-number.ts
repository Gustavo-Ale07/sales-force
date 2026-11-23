import { draftErpNumber, type DraftRecord } from "@salesforce/mobile-db";

/**
 * The only order number the seller ever sees is the unique Sankhya number (NUNOTA), and only once it exists. The internal Force
 * number (`remoteDraftNumber`) is never printed anywhere: before the confirmation the order is just "Pedido" / "Orçamento".
 */

type NumberSource = Pick<DraftRecord, "erpNumber" | "erpStage"> & Partial<Pick<DraftRecord, "serverSnapshot">>;

function snapshotNumber(snapshot: unknown): number | null {
  if (typeof snapshot !== "object" || snapshot === null || !("erpNumber" in snapshot)) return null;
  const value = (snapshot as { erpNumber: unknown }).erpNumber;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/** Sankhya number of the order, `null` while it is not known (not confirmed, or not delivered yet). */
export function erpNumberOfDraft(draft: NumberSource): number | null {
  return draftErpNumber(draft) ?? snapshotNumber(draft.serverSnapshot);
}

/** "Pedido nº 2511" / "Orçamento nº 2511"; without a number only the word ("Pedido" / "Orçamento"). */
export function orderIdentity(number: number | null, quotation: boolean): string {
  const word = quotation ? "Orçamento" : "Pedido";
  return number === null ? word : `${word} nº ${number}`;
}

/** Post-confirmation follow-up: the screen keeps asking for the Sankhya number while it is open, with growing intervals, for a bounded time. */
export const FOLLOW_BUDGET_MS = 60_000;
export const FOLLOW_FIRST_MS = 1_500;
export const FOLLOW_MAX_MS = 5_000;

/** Wait before read number `attempt` (0-based): 1.5 s growing by 40% each time, never above 5 s. */
export function followDelay(attempt: number): number {
  return Math.min(FOLLOW_MAX_MS, Math.round(FOLLOW_FIRST_MS * 1.4 ** attempt));
}

/** The list does not know the TOP catalog: a quotation is recognised by the stage the server classified. */
export function isQuotationDraft(draft: Pick<DraftRecord, "erpStage">): boolean {
  return draft.erpStage?.stage === "quotation";
}
