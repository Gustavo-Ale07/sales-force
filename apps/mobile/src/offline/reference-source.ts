import { TransportError, type DatasetIdentity, type MobilityCount, type PriceTableSnapshot, type RefreshOutcome, type RefreshProgress, type ReferenceSource } from "@salesforce/mobile-db";
import { ApiRequestError, callApi, type ApiClient } from "../data/api";
import type { CustomerListItem, OrderEntryConfiguration, ProductListItem } from "../data/ports";
import { toTransportError } from "./transport";

const PAGE_SIZE = 100; // MAX_PAGE_SIZE of the contract

/** Pulls every page one request at a time (no bursts against the API). */
async function fetchAllPages<T>(fetchPage: (page: number) => Promise<{ items: readonly T[]; total: number }>): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; ; page += 1) {
    const result = await fetchPage(page);
    all.push(...result.items);
    if (result.items.length === 0 || all.length >= result.total) return all;
  }
}

/**
 * The ONE place the server's dataset declaration is mapped to the sync engine's identity. `null` (the server cannot
 * tell, or an old/cached configuration without the field) means "unknown": callers fail closed.
 */
export function datasetIdentityOf(configuration: Pick<OrderEntryConfiguration, "dataset"> | null | undefined): DatasetIdentity | null {
  const dataset = configuration?.dataset;
  if (dataset === null || dataset === undefined) return null;
  if (typeof dataset.environment !== "string" || dataset.environment === "" || typeof dataset.datasetId !== "string" || dataset.datasetId === "") return null;
  return { environment: dataset.environment, datasetId: dataset.datasetId };
}

/**
 * Reference data for the offline cache, read through the same scoped endpoints the online screens use: the server
 * decides what the actor may see (P-21) and never sends cost or margin (P-20). Prices are the list prices of the
 * catalog reference table; the price that finally applies to an order is resolved by the server on sync (P-09).
 */
export interface RefreshTiming {
  /** Pause between two looks at the refresh (default 1.5 s). */
  readonly pollIntervalMs?: number;
  /** Longer than this the refresh counts as "server unavailable" (default 3 min). */
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  /** Page size of the price-table read (default and server maximum: 1000). */
  readonly priceTablePageSize?: number;
}

const PRICE_TABLE_PAGE_SIZE = 1000;

/** Friendly names of what the server refreshes (the seller's wording; no ERP names). */
const ENTITY_LABEL: Readonly<Record<string, string>> = {
  configuration: "Configuração",
  sellers: "Vendedores",
  customers: "Clientes",
  products: "Produtos",
  productGroups: "Grupos de produtos",
  priceTables: "Tabelas de preço",
  priceTableVersions: "Versões das tabelas de preço",
  listPrices: "Preços",
  carriers: "Transportadoras",
  ipiRates: "IPI",
  openTitles: "Títulos em aberto",
  orderStatus: "Situação dos pedidos",
};

const PHASE_LABEL: Readonly<Record<string, string>> = {
  cadastros: "Atualizando cadastros",
  precos: "Atualizando preços",
  pedidos: "Atualizando pedidos",
  concluido: "Concluindo",
};

interface RefreshStepView {
  readonly entity: string;
  readonly status: string;
  readonly mobility?: readonly MobilityCount[];
}

interface RefreshView {
  readonly status: string;
  readonly steps?: readonly RefreshStepView[];
  readonly progressPercent?: number;
  readonly phase?: string;
  readonly hasWarnings?: boolean;
}

const labelOf = (entity: string): string => ENTITY_LABEL[entity] ?? "Dados";

function progressOf(view: RefreshView): RefreshProgress {
  if (view.steps !== undefined) {
    const running = view.steps.find((s) => s.status === "running") ?? view.steps.find((s) => s.status === "pending");
    const finished = view.steps.filter((s) => s.status !== "pending" && s.status !== "running").length;
    return {
      label: running === undefined ? "Concluindo" : `Atualizando ${labelOf(running.entity).toLowerCase()}`,
      percent: view.steps.length === 0 ? null : Math.round((finished / view.steps.length) * 100),
    };
  }
  return { label: PHASE_LABEL[view.phase ?? ""] ?? "Atualizando dados", percent: view.progressPercent ?? null };
}

function outcomeOf(view: RefreshView): RefreshOutcome {
  if (view.steps !== undefined) {
    const failedSteps = [...new Set(view.steps.filter((s) => s.status === "failed").map((s) => labelOf(s.entity)))];
    const mobility = view.steps.flatMap((s) => s.mobility ?? []);
    return { failed: failedSteps.length > 0, failedSteps, ...(mobility.length > 0 ? { mobility } : {}) };
  }
  // The seller's view carries no entity names: only whether something failed.
  return { failed: view.hasWarnings === true, failedSteps: [] };
}

export function createReferenceSource(api: ApiClient, timing: RefreshTiming = {}): ReferenceSource {
  const pollIntervalMs = timing.pollIntervalMs ?? 1500;
  const timeoutMs = timing.timeoutMs ?? 180_000;
  const sleep = timing.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = timing.now ?? Date.now;
  const priceTablePageSize = timing.priceTablePageSize ?? PRICE_TABLE_PAGE_SIZE;
  /**
   * Reads ONE table page by page. The server may return fewer items than `pageSize` on a page (rows without a price are dropped
   * after paging) while `total` still counts them, so the loop goes by page number, never by `items.length < pageSize`.
   */
  const fetchPriceTable = async (code: number): Promise<PriceTableSnapshot> => {
    const prices: { productCode: number; listPrice: unknown }[] = [];
    for (let page = 1; ; page += 1) {
      const view = await callApi(() => api.GET("/price-tables/{code}/prices", { params: { path: { code }, query: { page, pageSize: priceTablePageSize } } }));
      for (const item of view.items) {
        prices.push({ productCode: item.productCode, listPrice: { state: "priced", unitPrice: item.unitPrice, tableCode: view.tableCode, versionId: view.versionId } });
      }
      if (view.items.length === 0 || page * priceTablePageSize >= view.total) break;
    }
    return { tableCode: code, prices };
  };
  const guard = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      throw toTransportError(error);
    }
  };
  return {
    // POST /sync/refresh (the server reuses a refresh younger than a minute), then GET /sync/refresh/{id} until it is done.
    refreshOnDemand: async (onProgress) => {
      const startedAt = now();
      let view: RefreshView & { id?: string };
      try {
        view = (await callApi(() => api.POST("/sync/refresh"))) as unknown as RefreshView & { id: string };
      } catch (error) {
        // This profile may not start a refresh: the device still downloads what the server already has.
        if (error instanceof ApiRequestError && error.status === 403) return { failed: false, failedSteps: [] };
        throw toTransportError(error);
      }
      const id = (view as { id: string }).id;
      for (;;) {
        if (view.status === "done") return outcomeOf(view);
        onProgress(progressOf(view));
        if (now() - startedAt > timeoutMs) throw new TransportError("server", "A atualização do servidor demorou demais.");
        await sleep(pollIntervalMs);
        view = await guard(
          async () => (await callApi(() => api.GET("/sync/refresh/{id}", { params: { path: { id } } }))) as unknown as RefreshView,
        );
      }
    },
    fetchCustomers: () =>
      guard(() =>
        fetchAllPages<CustomerListItem>((page) =>
          callApi(() => api.GET("/customers", { params: { query: { page, pageSize: PAGE_SIZE, sort: "name" } } })),
        ),
      ),
    fetchProducts: () =>
      guard(() =>
        fetchAllPages<ProductListItem>(
          (page) =>
            callApi(() => api.GET("/products", { params: { query: { page, pageSize: PAGE_SIZE, sort: "description" } } })) as Promise<{
              items: readonly ProductListItem[];
              total: number;
            }>,
        ),
      ),
    // Bulk endpoint, one table at a time (owner 2026-11-13). 404 = the server does not serve this table (left out); 5xx and the
    // like = this table failed (previous prices may stay); no network, session or rate limit stop everything and are THROWN.
    fetchPriceTables: async (tableCodes) => {
      const tables: PriceTableSnapshot[] = [];
      const failed: number[] = [];
      for (const code of tableCodes) {
        try {
          tables.push(await fetchPriceTable(code));
        } catch (error) {
          const transport = toTransportError(error);
          if (transport.kind === "not_found") continue;
          if (transport.kind === "server") {
            failed.push(code);
            continue;
          }
          throw transport;
        }
      }
      return { tables, failed };
    },
    fetchEntryConfiguration: () => guard(() => callApi(() => api.GET("/order-entry/configuration"))),
    // Same endpoint the online carrier picker uses; the pull treats a failure here as non-fatal.
    fetchCarriers: () => guard(async () => (await callApi(() => api.GET("/carriers"))).items),
    fetchDatasetIdentity: () => guard(async () => datasetIdentityOf(await callApi(() => api.GET("/order-entry/configuration")))),
  };
}
