import type { DraftRecord } from "@salesforce/mobile-db";
import { renderOrderHtml, toOrderDocument, type OrderDocumentModel } from "@salesforce/domain";
import { previewDraft, type EditorLine } from "../data/order-draft";
import { saleBadge } from "./sales-status";
import { saleValue } from "./sales";

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

/** Sankhya order number, only when the stored server snapshot carries one as a number. */
function erpNumberOf(snapshot: unknown): number | null {
  if (typeof snapshot !== "object" || snapshot === null || !("erpNumber" in snapshot)) return null;
  const value = (snapshot as { erpNumber: unknown }).erpNumber;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export function orderDocumentOf(draft: DraftRecord, lines: readonly EditorLine[]): OrderDocumentModel {
  const preview = previewDraft(lines);
  const items = preview.lines.flatMap((entry) => (entry.item === null ? [] : [entry.item]));
  const value = saleValue(draft, lines);
  return toOrderDocument({
    draftNumber: draft.remoteDraftNumber,
    erpNumber: erpNumberOf(draft.serverSnapshot),
    customerCode: draft.customerCode,
    customerName: draft.customerName,
    statusLabel: saleBadge({ status: draft.status, remoteId: draft.remoteId, lastError: draft.lastError }).label,
    createdAt: draft.createdAt,
    notes: draft.notes,
    items,
    totals: {
      estimatedTotal: value.amount ?? preview.totals.estimatedTotal,
      isPartial: value.partial,
      unpricedLineCount: preview.totals.unpricedLineCount,
    },
  });
}

export function buildOrderPdfHtml(draft: DraftRecord, lines: readonly EditorLine[], logoSrc: string | null): string {
  return renderOrderHtml(orderDocumentOf(draft, lines), logoSrc === null ? { brandName: 'PLAC' } : { logoSrc, brandName: 'PLAC' });
}

export type ShareOrderPdfResult = { readonly ok: true } | { readonly ok: false; readonly reason: "empty" | "failed" };

export async function shareOrderPdf(
  port: OrderPdfPort,
  draft: DraftRecord,
  lines: readonly EditorLine[],
): Promise<ShareOrderPdfResult> {
  if (lines.length === 0) return { ok: false, reason: "empty" };
  try {
    const logoSrc = port.logoDataUri === undefined ? null : await port.logoDataUri().catch(() => null);
    await port.sharePdf(buildOrderPdfHtml(draft, lines, logoSrc), draft.remoteDraftNumber === null ? "pedido-rascunho" : `pedido-${draft.remoteDraftNumber}`);
    return { ok: true };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
