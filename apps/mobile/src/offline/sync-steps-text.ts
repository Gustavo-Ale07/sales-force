import type { SyncStep, SyncStepId } from "@salesforce/mobile-db";

/** The five things the seller sees; each groups the internal steps of the sync pipeline. */
export type SellerStepId = "send" | "customers" | "products" | "conditions" | "finishing";
export type SellerStepState = "pending" | "running" | "done";

export interface SellerStep {
  readonly id: SellerStepId;
  readonly label: string;
  readonly state: SellerStepState;
}

const LABEL: Readonly<Record<SellerStepId, string>> = {
  send: "Enviando pedidos",
  customers: "Clientes",
  products: "Produtos e preços",
  conditions: "Condições de venda",
  finishing: "Finalizando",
};

/** Internal step -> seller step, in the order they run (the send queue goes before the downloads). */
const GROUPS: ReadonlyArray<{ readonly id: SellerStepId; readonly members: readonly SyncStepId[] }> = [
  { id: "send", members: ["push"] },
  { id: "customers", members: ["server", "customers"] },
  { id: "products", members: ["products", "prices"] },
  { id: "conditions", members: ["negotiation", "carriers"] },
  { id: "finishing", members: ["save", "orders"] },
];

/** 0..1 when the step can tell how far it is; `null` = unknown. */
export function stepFraction(step: SyncStep): number | null {
  if (step.state === "done" || step.state === "error") return 1;
  if (step.state === "pending") return 0;
  if (step.total !== null && step.total > 0 && step.count !== null) return Math.min(1, step.count / step.total);
  return null;
}

/** Orders/customers queued for sending: the first step only exists when there is something to send. */
function hasSomethingToSend(steps: readonly SyncStep[]): boolean {
  const push = steps.find((step) => step.id === "push");
  if (push === undefined) return false;
  return Math.max(push.total ?? 0, push.count ?? 0) > 0;
}

/** A member that ended (even with a kept-previous remark) counts as finished: the run's failure is reported by the popup, not here. */
const finished = (step: SyncStep): boolean => step.state === "done" || step.state === "error";

/** The short list of at most five steps with their state (no counts, no times). */
export function sellerSteps(steps: readonly SyncStep[]): readonly SellerStep[] {
  const showSend = hasSomethingToSend(steps);
  const out: SellerStep[] = [];
  for (const group of GROUPS) {
    if (group.id === "send" && !showSend) continue;
    const members = steps.filter((step) => (group.members as readonly string[]).includes(step.id));
    if (members.length === 0) continue;
    const done = members.filter(finished).length;
    const running = members.some((step) => step.state === "running");
    const state: SellerStepState = done === members.length ? "done" : running || done > 0 ? "running" : "pending";
    out.push({ id: group.id, label: LABEL[group.id], state });
  }
  return out;
}

/** Overall progress 0..1 over the steps that apply (the send step only counts when there is something to send). */
export function overallFraction(steps: readonly SyncStep[]): number {
  const relevant = hasSomethingToSend(steps) ? steps : steps.filter((step) => step.id !== "push");
  if (relevant.length === 0) return 0;
  const total = relevant.reduce((sum, step) => sum + (stepFraction(step) ?? 0), 0);
  return Math.min(1, total / relevant.length);
}

/** Text for the screen reader's live region: which seller step is current ("Clientes"), never a count. */
export function currentStepText(steps: readonly SyncStep[]): string {
  const list = sellerSteps(steps);
  const current = list.find((step) => step.state === "running") ?? list.find((step) => step.state === "pending");
  return current === undefined ? "Finalizando" : current.label;
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
