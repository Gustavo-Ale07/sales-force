import type { SyncStep, SyncStepId, SyncStepState } from "@salesforce/mobile-db";

/** The seller's wording of each step of the full sync (no ERP names beyond "Sankhya", which the owner asked to show). */
export const STEP_LABEL: Readonly<Record<SyncStepId, string>> = {
  push: "Enviando pedidos e pendências",
  server: "Lendo o Sankhya",
  customers: "Clientes",
  products: "Produtos",
  prices: "Preços",
  negotiation: "Tipos de negociação",
  carriers: "Transportadoras",
  save: "Gravando no aparelho",
  orders: "Situação dos pedidos enviados",
};

const STATE_TEXT: Readonly<Record<SyncStepState, string>> = {
  pending: "aguardando",
  running: "em andamento",
  done: "concluído",
  error: "com problema",
};

/** 0..1 when the step can tell how far it is; `null` = unknown (shown as indeterminate). */
export function stepFraction(step: SyncStep): number | null {
  if (step.state === "done") return 1;
  if (step.state === "pending") return 0;
  if (step.state === "error") return null;
  if (step.total !== null && step.total > 0 && step.count !== null) return Math.min(1, step.count / step.total);
  return null;
}

/** Right-hand count of a row: "120 de 480", "480", "Nada a enviar", "" while nothing is known. */
export function stepCountText(step: SyncStep): string {
  if (step.state === "pending") return "";
  if (step.state === "error") return step.note ?? "";
  if (step.id === "server") return step.state === "running" ? "aguardando o servidor" : "";
  if (step.state === "running") {
    if (step.note !== undefined && step.count !== null) return `${step.note} · ${step.count} preços`;
    if (step.count !== null && step.total !== null) return `${step.count} de ${step.total}`;
    return step.count !== null && step.count > 0 ? String(step.count) : "";
  }
  // done
  if (step.id === "push") return step.count === null || step.count === 0 ? "Nada a enviar" : `${step.count} ${step.count === 1 ? "enviado" : "enviados"}`;
  if (step.id === "prices" && step.note !== undefined) return `${step.count ?? 0} preços · ${step.note}`;
  if (step.id === "save" || step.id === "orders") return "";
  return step.count === null ? "" : String(step.count);
}

/** Text a screen reader gets for the row. */
export function stepAccessibilityLabel(step: SyncStep): string {
  const count = stepCountText(step);
  return `${STEP_LABEL[step.id]}: ${STATE_TEXT[step.state]}${count === "" ? "" : `, ${count}`}`;
}

/** "3 de 9 etapas" (finished steps over all). */
export function overallText(steps: readonly SyncStep[]): string {
  const finished = steps.filter((step) => step.state === "done" || step.state === "error").length;
  return `${finished} de ${steps.length} etapas`;
}

/** Catalog code of the popup that explains a failed run (the seller-safe cause set by the sync engine). */
export function failureCode(failure: string | null | undefined): string {
  switch (failure) {
    case "no_internet":
      return "offline";
    case "server_unavailable":
      return "service_unavailable";
    case "sankhya_unavailable":
      return "sankhya_unavailable";
    case "auth":
      return "unauthenticated";
    default:
      return "sync_failed";
  }
}
