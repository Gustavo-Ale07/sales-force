import type { DraftRecord } from "@salesforce/mobile-db";
import { renderOrderHtml, toOrderDocument, type OrderDocumentModel } from "@salesforce/domain";
import { previewDraft, type EditorLine } from "../data/order-draft";
import { isCustomerUnavailable, isProductBlocked, saleBadge } from "./sales-status";
import { saleValue } from "./sales";
import { erpNumberOfDraft } from "./order-number";

/**
 * Order PDF for the share sheet (D-J, RF-ORD-10): the same PLAC template as the web, built from the LOCAL order, so it
 * works offline. The model is copied through the domain allow-list: no cost, margin or other snapshot field (P-20).
 * One order at a time; there is no bulk export.
 */

export interface OrderPdfPort {
  /** Renders the HTML to a PDF file, opens the OS share sheet and deletes the temporary file afterwards. */
  readonly sharePdf: (html: string, fileName: string) => Promise<void>;
  /** PLAC logo as a data URI (works offline); `null`/absent = the template's text wordmark. */
  readonly logoDataUri?: () => Promise<string | null>;
}

/**
 * The badge printed on the PDF. A draft held because its customer or a product is unavailable is an internal review state of the
 * app: the document never carries that seal ("Cliente indisponível", "Produto indisponível"), it prints the plain local state.
 */
export function pdfStatusLabelOf(draft: Pick<DraftRecord, "status" | "remoteId" | "lastError">): string {
  if (isCustomerUnavailable(draft) || isProductBlocked(draft)) return saleBadge({ status: draft.status, remoteId: draft.remoteId, lastError: null }).label;
  return saleBadge({ status: draft.status, remoteId: draft.remoteId, lastError: draft.lastError }).label;
}

/** An order held because its customer is unavailable has no document: the seal is an internal state, so nothing is printed. */
export class OrderPdfCustomerUnavailableError extends Error {
  constructor() {
    super("Cliente indisponível: o PDF deste pedido não é gerado.");
    this.name = "OrderPdfCustomerUnavailableError";
  }
}

export function orderDocumentOf(draft: DraftRecord, lines: readonly EditorLine[]): OrderDocumentModel {
  if (isCustomerUnavailable(draft)) throw new OrderPdfCustomerUnavailableError();
  const preview = previewDraft(lines);
  const items = preview.lines.flatMap((entry) => (entry.item === null ? [] : [entry.item]));
  const value = saleValue(draft, lines);
  return toOrderDocument({
    // The internal Force number is never printed (owner 2026-11-23): the only number on the document is the Sankhya one.
    draftNumber: null,
    erpNumber: erpNumberOfDraft(draft),
    customerCode: draft.customerCode,
    customerName: draft.customerName,
    statusLabel: pdfStatusLabelOf(draft),
    createdAt: draft.createdAt,
    notes: draft.notes,
    items,
    totals: {
      estimatedTotal: value.amount ?? preview.totals.estimatedTotal,
      isPartial: value.partial,
      unpricedLineCount: preview.totals.unpricedLineCount,
    },
    ipi: {
      ipiEstimated: preview.ipi.ipiEstimated,
      grandTotalEstimated: preview.ipi.grandTotalEstimated,
      isPartial: preview.ipi.isPartial,
    },
  });
}

/** File name of the shared PDF: the Sankhya number once the order has one, otherwise just "pedido" (never the internal number). */
export function pdfFileNameOf(draft: Pick<DraftRecord, "erpNumber" | "erpStage" | "serverSnapshot">): string {
  const number = erpNumberOfDraft(draft);
  return number === null ? "pedido" : `pedido-${number}`;
}

export function buildOrderPdfHtml(draft: DraftRecord, lines: readonly EditorLine[], logoSrc: string | null): string {
  return renderOrderHtml(orderDocumentOf(draft, lines), logoSrc === null ? { brandName: 'PLAC' } : { logoSrc, brandName: 'PLAC' });
}

export type ShareOrderPdfResult = { readonly ok: true } | { readonly ok: false; readonly reason: "empty" | "customer_unavailable" | "failed" };

export async function shareOrderPdf(
  port: OrderPdfPort,
  draft: DraftRecord,
  lines: readonly EditorLine[],
): Promise<ShareOrderPdfResult> {
  if (lines.length === 0) return { ok: false, reason: "empty" };
  if (isCustomerUnavailable(draft)) return { ok: false, reason: "customer_unavailable" };
  try {
    const logoSrc = port.logoDataUri === undefined ? null : await port.logoDataUri().catch(() => null);
    await port.sharePdf(buildOrderPdfHtml(draft, lines, logoSrc), pdfFileNameOf(draft));
    return { ok: true };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
