import type { ApiSchema } from "@salesforce/contracts/client";

export type SyncRefresh = ApiSchema<"SyncRefresh">;
export type SyncRefreshStep = ApiSchema<"SyncRefreshStep">;

/** How often the dialog asks the API for the progress of the worker. */
export const REFRESH_POLL_MS = 1_500;

/** What the seller reads, one per entity (never the technical name). */
export const ENTITY_LABELS: Record<SyncRefreshStep["entity"], string> = {
  configuration: "Configuração",
  sellers: "Vendedores",
  customers: "Clientes",
  products: "Produtos",
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

/** One line per step for the right-hand side of the row. */
export function stepDetail(step: SyncRefreshStep): string {
  switch (step.status) {
    case "pending":
      return "Aguardando";
    case "running":
      return "Lendo…";
    case "ok":
      return step.rowsRead === null ? "Atualizado" : `${step.rowsRead.toLocaleString("pt-BR")} lidos`;
    case "skipped":
      return step.reason ?? "Não aplicável";
    case "failed": {
      const kept = step.lastSuccessAt ? ` Mantidos os dados de ${clockTime(step.lastSuccessAt)}.` : " Mantidos os dados anteriores.";
      return `${step.reason ?? "Falhou."}${kept}`;
    }
  }
}
