import type { DraftRecord } from "@salesforce/mobile-db";
import { documentFreightLabels, documentStatusLabels, documentIpiPercent, orderDocumentConditions, renderOrderHtml, resolveDocumentCarrier, toOrderDocument, type OrderDocumentCustomerRegistry, type OrderDocumentModel } from "@salesforce/domain";
import { previewDraft, type EditorLine } from "../data/order-draft";
import { isCustomerUnavailable, isProductBlocked, sendPhaseOf } from "./sales-status";
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

/** Force order status behind each send phase of the app, to print the same seal as the site (`documentStatusLabels`). */
const PHASE_STATUS = {
  waiting: "queued",
  refused: "rejected",
  rejected: "rejected",
  in_sankhya: "sent",
  verifying: "unknown",
  awaiting_approval: "awaiting_approval",
  approval_rejected: "approval_rejected",
  approved: "approved",
} as const;

/**
 * The seal printed on the PDF, the same words as the site for the same order (PAR-1): the Force status only, never a Sankhya stage
 * and never a device-only state ("Salvo no aparelho", "Erro", held seals) - those print as "Não enviado".
 */
export function pdfStatusLabelOf(draft: Pick<DraftRecord, "status" | "remoteId"> & Partial<Pick<DraftRecord, "lastError" | "sendState" | "sendCode">>): string {
  if (isCustomerUnavailable(draft) || isProductBlocked(draft)) return documentStatusLabels.draft;
  const phase = draft.status === "synced" || draft.sendState === "requested" ? sendPhaseOf(draft) : null;
  return documentStatusLabels[phase === null ? "draft" : PHASE_STATUS[phase]];
}

/** An order held because its customer is unavailable has no document: the seal is an internal state, so nothing is printed. */
export class OrderPdfCustomerUnavailableError extends Error {
  constructor() {
    super("Cliente indisponível: o PDF deste pedido não é gerado.");
    this.name = "OrderPdfCustomerUnavailableError";
  }
}

/** Installation data the document prints by label; absent = the code is printed instead. */
export interface OrderPdfExtras {
  readonly negotiationTypes?: readonly { readonly code: number; readonly label: string }[];
  /** Quotation or order (the TOP rules of the installation); absent = order. */
  readonly kind?: "order" | "quote";
  /** Moment of issue printed under the document, like the site; the caller's clock. */
  readonly issuedAt?: string;
  /** Carriers known on the device (last stored list): resolves the order's carrier code to a name. */
  readonly carriers?: readonly { readonly code: number; readonly name: string }[];
  /** Customer's default carrier name (Sankhya), used when the order has none. */
  readonly customerDefaultCarrierName?: string | null;
  /** Registry data of the customer (mirror or the one saved offline in the Force) for the seller to double-check; absent = dashes. */
  readonly customerRegistry?: OrderDocumentCustomerRegistry;
}

/** Carrier line of the document: the order's carrier, else the customer's default, else null (a dash). */
export function carrierNameOf(draft: Pick<DraftRecord, "carrierCode">, extras: Pick<OrderPdfExtras, "carriers" | "customerDefaultCarrierName">): string | null {
  const own = draft.carrierCode === null ? undefined : extras.carriers?.find((carrier) => carrier.code === draft.carrierCode)?.name;
  return resolveDocumentCarrier(own, extras.customerDefaultCarrierName);
}

export function orderDocumentOf(draft: DraftRecord, lines: readonly EditorLine[], extras: OrderPdfExtras = {}): OrderDocumentModel {
  if (isCustomerUnavailable(draft)) throw new OrderPdfCustomerUnavailableError();
  const preview = previewDraft(lines);
  const items = preview.lines.flatMap((entry, index) =>
    entry.item === null ? [] : [{ ...entry.item, ipiPercent: documentIpiPercent(lines[index]?.ipi), barcode: lines[index]?.barcode ?? null }],
  );
  const value = saleValue(draft, lines);
  return toOrderDocument({
    ...(extras.kind === undefined ? {} : { kind: extras.kind }),
    // The internal Force number is never printed (owner 2026-11-23): the only number on the document is the Sankhya one.
    erpNumber: erpNumberOfDraft(draft),
    customerCode: draft.customerCode,
    customerName: draft.customerName,
    carrierName: carrierNameOf(draft, extras),
    ...(extras.customerRegistry === undefined ? {} : { customerRegistry: extras.customerRegistry }),
    conditions: orderDocumentConditions({
      negotiationTypeCode: draft.negotiationTypeCode,
      ...(extras.negotiationTypes === undefined ? {} : { negotiationTypes: extras.negotiationTypes }),
      freightLabel: draft.freightType === null ? null : documentFreightLabels[draft.freightType],
    }),
    statusLabel: pdfStatusLabelOf(draft),
    createdAt: draft.createdAt,
    notes: draft.notes,
    items,
    totals: {
      estimatedTotal: preview.totals.estimatedTotal,
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

export function buildOrderPdfHtml(draft: DraftRecord, lines: readonly EditorLine[], logoSrc: string | null, extras: OrderPdfExtras = {}): string {
  return renderOrderHtml(orderDocumentOf(draft, lines, extras), { ...(logoSrc === null ? {} : { logoSrc }), brandName: 'PLAC', ...(extras.issuedAt === undefined ? {} : { issuedAt: extras.issuedAt }) });
}

export type ShareOrderPdfResult = { readonly ok: true } | { readonly ok: false; readonly reason: "empty" | "customer_unavailable" | "failed" };

export async function shareOrderPdf(
  port: OrderPdfPort,
  draft: DraftRecord,
  lines: readonly EditorLine[],
  extras: OrderPdfExtras = {},
): Promise<ShareOrderPdfResult> {
  if (lines.length === 0) return { ok: false, reason: "empty" };
  if (isCustomerUnavailable(draft)) return { ok: false, reason: "customer_unavailable" };
  try {
    const logoSrc = port.logoDataUri === undefined ? null : await port.logoDataUri().catch(() => null);
    await port.sharePdf(buildOrderPdfHtml(draft, lines, logoSrc, { issuedAt: new Date().toISOString(), ...extras }), pdfFileNameOf(draft));
    return { ok: true };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
