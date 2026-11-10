import type { ApiSchema } from "@salesforce/contracts/client";

export type SyncRefresh = ApiSchema<"SyncRefresh">;
export type SyncRefreshStep = ApiSchema<"SyncRefreshStep">;

/** How often the dialog asks the API for the progress of the worker. */
export const REFRESH_POLL_MS = 1_500;

/** No step started after this long: the action line says it is waiting for the service. */
export const REFRESH_WAITING_AFTER_S = 15;
/** Nothing advanced for this long: the dialog stops blocking and offers to try again or close. */
export const REFRESH_STALLED_AFTER_S = 60;

/** What the seller reads, one per entity (never the technical name). */
export const ENTITY_LABELS: Record<SyncRefreshStep["entity"], string> = {
  configuration: "Configuração",
  sellers: "Vendedores",
  customers: "Clientes",
  products: "Produtos",
  productGroups: "Grupos de produtos",
  priceTables: "Tabelas de preço",
  priceTableVersions: "Versões das tabelas de preço",
  listPrices: "Preços de lista",
  carriers: "Transportadoras",
  ipiRates: "Alíquotas de IPI",
  openTitles: "Títulos em aberto",
  orderStatus: "Situação dos pedidos no Sankhya",
};

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

/** The three blocks of the detail view (D-AC C2). */
export const REFRESH_GROUPS: ReadonlyArray<{ title: string; entities: ReadonlyArray<SyncRefreshStep["entity"]> }> = [
  { title: "Cadastros", entities: ["configuration", "sellers", "customers", "products", "productGroups", "carriers"] },
  { title: "Preços", entities: ["priceTables", "priceTableVersions", "listPrices", "ipiRates"] },
  { title: "Financeiro e pedidos", entities: ["openTitles", "orderStatus"] },
];

/** The action line of the detail view while one step runs ("Lendo clientes…"). */
export const ENTITY_ACTION: Record<SyncRefreshStep["entity"], string> = {
  configuration: "Lendo a configuração…",
  sellers: "Lendo vendedores…",
  customers: "Lendo clientes…",
  products: "Lendo produtos…",
  productGroups: "Lendo grupos de produtos…",
  priceTables: "Lendo tabelas de preço…",
  priceTableVersions: "Lendo versões das tabelas…",
  listPrices: "Lendo preços de lista…",
  carriers: "Lendo transportadoras…",
  ipiRates: "Lendo alíquotas de IPI…",
  openTitles: "Lendo títulos em aberto…",
  orderStatus: "Lendo a situação dos pedidos…",
};

/** The current step of a run: the running one, else (once something finished) the next pending one, else none. */
export function currentStep(steps: readonly SyncRefreshStep[]): SyncRefreshStep | undefined {
  const running = steps.find((step) => step.status === "running");
  if (running) return running;
  return steps.some((step) => step.status !== "pending") ? steps.find((step) => step.status === "pending") : undefined;
}

/** Sentence of the basic view, per phase. */
export const PHASE_CAPTION = {
  cadastros: "Atualizando cadastros…",
  precos: "Atualizando preços…",
  pedidos: "Atualizando pedidos…",
  concluido: "Atualização concluída",
} as const;

/** Steps finished (ok, failed or skipped) out of all, and the matching percentage. */
export function stepProgress(steps: readonly SyncRefreshStep[]): { finished: number; total: number; percent: number } {
  const total = steps.length;
  const finished = steps.filter((step) => step.status === "ok" || step.status === "failed" || step.status === "skipped").length;
  return { finished, total, percent: total === 0 ? 0 : Math.floor((finished / total) * 100) };
}

/** Short second line of a failed row: the masked reason and how old the kept data is. */
export function stepNote(step: SyncRefreshStep): string | null {
  if (step.status === "skipped") return step.reason;
  if (step.status !== "failed") return null;
  const kept = step.lastSuccessAt ? `Mantidos os dados de ${clockTime(step.lastSuccessAt)}.` : "Mantidos os dados anteriores.";
  return step.reason ? `${step.reason} ${kept}` : kept;
}

export const STEP_STATE = { pending: "pending", running: "running", ok: "done", failed: "failed", skipped: "skipped" } as const;
