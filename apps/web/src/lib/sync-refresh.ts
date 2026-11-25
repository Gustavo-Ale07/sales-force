import type { ApiSchema } from "@salesforce/contracts/client";

export type SyncRefresh = ApiSchema<"SyncRefresh">;
export type SyncRefreshStep = ApiSchema<"SyncRefreshStep">;

/** How often the dialog asks the API for the progress of the worker. */
export const REFRESH_POLL_MS = 1_500;

/** No step started after this long: the action line says it is waiting for the service. */
export const REFRESH_WAITING_AFTER_S = 15;
/** Nothing advanced for this long: the dialog stops blocking and offers to try again or close. */
export const REFRESH_STALLED_AFTER_S = 60;

/** "14:05" in Brasília time, whatever the browser's zone. */
export function clockTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(iso));
}

export function failedSteps(refresh: SyncRefresh): SyncRefreshStep[] {
  return refresh.steps.filter((step) => step.status === "failed");
}

/** Profiles that receive the detail from the server (D-AC); everyone else gets only the basics. Mirrors the contract. */
const DETAIL_ROLES: readonly string[] = ["admin", "manager", "technical"];
export function seesRefreshDetail(role: string): boolean {
  return DETAIL_ROLES.includes(role);
}

/** Steps finished (ok, failed or skipped) out of all, and the matching percentage. */
export function stepProgress(steps: readonly SyncRefreshStep[]): { finished: number; total: number; percent: number } {
  const total = steps.length;
  const finished = steps.filter((step) => step.status === "ok" || step.status === "failed" || step.status === "skipped").length;
  return { finished, total, percent: total === 0 ? 0 : Math.floor((finished / total) * 100) };
}
