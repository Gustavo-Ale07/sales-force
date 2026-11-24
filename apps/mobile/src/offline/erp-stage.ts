import { ORDER_STAGE_CODES, ORDER_STAGE_LABELS, ORDER_STAGE_TIMELINE, type OrderStageCode } from "@salesforce/domain";
import type { DraftErpStage } from "@salesforce/mobile-db";

/**
 * Presentation of the stage of an order following Sankhya. The SERVER classifies (packages/domain `classifyOrderStage`); the app
 * only renders the last stage it downloaded and never derives one. Tones mirror the list badge tones.
 */
export type StageTone = "neutral" | "info" | "ok" | "warning" | "danger";

const TONES: Readonly<Record<OrderStageCode, StageTone>> = {
  sent_to_force: "info",
  send_error: "danger",
  quotation: "neutral",
  received: "info",
  in_review: "warning",
  financial_check: "warning",
  in_dispatch: "info",
  in_invoicing: "info",
  invoiced: "ok",
  barred: "danger",
};

export interface StageStep {
  readonly code: OrderStageCode;
  readonly label: string;
  readonly state: "done" | "current" | "todo";
}

export interface ErpStageView {
  readonly code: string;
  readonly label: string;
  readonly tone: StageTone;
  /** `timeline` = the six stages; `quotation` = number only; `force` = a Force-side state, no timeline. */
  readonly kind: "timeline" | "quotation" | "force";
  readonly steps: readonly StageStep[];
  readonly pendingSector: string | null;
  readonly nunota: number | null;
  readonly invoiceNumber: number | null;
  /** When the stage was last confirmed by the server (last successful read, else the last change). */
  readonly asOf: string;
  /** Catalog code of the last read failure; `null` = the last read worked. */
  readonly readErrorCode: string | null;
}

function isStageCode(code: string): code is OrderStageCode {
  return (ORDER_STAGE_CODES as readonly string[]).includes(code);
}

/** Catalog code of a stage read failure (`erp_stage_<errorClass>`, generic when the class is unknown). */
export function stageReadErrorCode(readError: NonNullable<DraftErpStage["readError"]>): string {
  const specific = readError.errorCode === "configuration_unavailable" ? "erp_stage_configuration_unavailable" : `erp_stage_${readError.errorClass}`;
  return STAGE_ERROR_CODES.includes(specific) ? specific : "erp_stage_read_failed";
}

const STAGE_ERROR_CODES: readonly string[] = [
  "erp_stage_unavailable",
  "erp_stage_temporary",
  "erp_stage_rate_limit",
  "erp_stage_auth",
  "erp_stage_validation",
  "erp_stage_permanent",
  "erp_stage_configuration_unavailable",
];

/** `null` when the order has no known stage (never read, or an old server): callers keep the previous labels. */
export function erpStageViewOf(stage: DraftErpStage | null | undefined): ErpStageView | null {
  if (stage === null || stage === undefined) return null;
  const known = isStageCode(stage.stage);
  const code = known ? (stage.stage as OrderStageCode) : null;
  const index = code === null ? -1 : ORDER_STAGE_TIMELINE.indexOf(code);
  const kind: ErpStageView["kind"] = index >= 0 ? "timeline" : code === "quotation" ? "quotation" : "force";
  const steps: StageStep[] =
    kind === "timeline"
      ? ORDER_STAGE_TIMELINE.map((step, position) => ({ code: step, label: ORDER_STAGE_LABELS[step], state: position < index ? "done" : position === index ? "current" : "todo" }))
      : [];
  return {
    code: stage.stage,
    label: stage.label,
    tone: code === null ? "neutral" : TONES[code],
    kind,
    steps,
    pendingSector: stage.pendingSector,
    nunota: stage.nunota,
    invoiceNumber: stage.invoiceNumber,
    asOf: stage.checkedAt ?? stage.updatedAt,
    readErrorCode: stage.readError === null ? null : stageReadErrorCode(stage.readError),
  };
}

/** The stages offered by the list filter, in the order a seller follows them (the server's labels). */
export const STAGE_FILTER_OPTIONS: ReadonlyArray<{ readonly value: OrderStageCode; readonly label: string }> = (
  ["sent_to_force", "send_error", "quotation", ...ORDER_STAGE_TIMELINE, "barred"] as const
).map((value) => ({ value, label: ORDER_STAGE_LABELS[value] }));
