import { TransportError, type DatasetIdentity, type MobilityCount, type PageProgress, type OrderErpStatus, type ServerOrderSummary, type PriceTableSnapshot, type RefreshOutcome, type RefreshProgress, type ReferenceSource } from "@salesforce/mobile-db";
import { deliveryErrorText } from "@salesforce/domain";
import { ApiRequestError, callApi, type ApiClient } from "../data/api";
import type { CustomerListItem, OrderEntryConfiguration, ProductListItem } from "../data/ports";
import { toTransportError } from "./transport";

const PAGE_SIZE = 100; // MAX_PAGE_SIZE of the contract

/** Pulls every page one request at a time (no bursts against the API). */
async function fetchAllPages<T>(fetchPage: (page: number) => Promise<{ items: readonly T[]; total: number }>, onPage?: PageProgress): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; ; page += 1) {
    const result = await fetchPage(page);
    all.push(...result.items);
    onPage?.(all.length, result.total);
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
  /** Page size of `GET /orders?ids=` (the server caps it at 100, also the most ids per call). */
  readonly orderStatusPageSize?: number;
}

const PRICE_TABLE_PAGE_SIZE = 1000;
const ORDER_STATUS_PAGE_SIZE = 100;

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
    let tableName: string | null = null;
    for (let page = 1; ; page += 1) {
      const view = await callApi(() => api.GET("/price-tables/{code}/prices", { params: { path: { code }, query: { page, pageSize: priceTablePageSize } } }));
      tableName = view.tableName ?? tableName;
      for (const item of view.items) {
        prices.push({ productCode: item.productCode, listPrice: { state: "priced", unitPrice: item.unitPrice, tableCode: view.tableCode, versionId: view.versionId } });
      }
      if (view.items.length === 0 || page * priceTablePageSize >= view.total) break;
    }
    return { tableCode: code, tableName, prices };
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
    fetchCustomers: (onPage) =>
      guard(() =>
        fetchAllPages<CustomerListItem>(
          (page) => callApi(() => api.GET("/customers", { params: { query: { page, pageSize: PAGE_SIZE, sort: "name" } } })),
          onPage,
        ),
      ),
    fetchProducts: (onPage) =>
      guard(() =>
        fetchAllPages<ProductListItem>(
          (page) =>
            callApi(() => api.GET("/products", { params: { query: { page, pageSize: PAGE_SIZE, sort: "description" } } })) as Promise<{
              items: readonly ProductListItem[];
              total: number;
            }>,
          onPage,
        ),
      ),
    // Bulk endpoint, one table at a time (owner 2026-11-13). 404 = the server does not serve this table (left out); 5xx and the
    // like = this table failed (previous prices may stay); no network, session or rate limit stop everything and are THROWN.
    fetchPriceTables: async (tableCodes, onTable) => {
      const tables: PriceTableSnapshot[] = [];
      const failed: number[] = [];
      let rows = 0;
      let visited = 0;
      for (const code of tableCodes) {
        try {
          const table = await fetchPriceTable(code);
          tables.push(table);
          rows += table.prices.length;
          visited += 1;
          onTable?.(visited, tableCodes.length, rows);
        } catch (error) {
          visited += 1;
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
    // Only the ERP status fields of orders the device holds; the server answers only within the caller's scope.
    fetchOrderStatuses: (orderIds) =>
      guard(async () => {
        const found: OrderErpStatus[] = [];
        const removedIds = new Set<string>();
        const pageSize = timing.orderStatusPageSize ?? ORDER_STATUS_PAGE_SIZE;
        for (let page = 1; ; page += 1) {
          const view = await callApi(() => api.GET("/orders", { params: { query: { ids: orderIds.join(","), page, pageSize } } }));
          // RT-1: orders whose ERP note no longer exists; the device drops its copy (never one with unsent work).
          for (const id of view.removedIds ?? []) removedIds.add(id);
          for (const order of view.items) {
            found.push({
              orderId: order.id,
              erpNumber: order.erpNumber,
              code: order.erpStatus?.code ?? null,
              label: order.erpStatus?.label ?? null,
              invoiceNumber: order.erpStatus?.invoiceNumber ?? null,
              checkedAt: order.erpStatus?.checkedAt ?? null,
              // Old server: no `erpStage` at all, so the stored stage is left alone.
              ...(order.erpStage === undefined || order.erpStage === null
                ? {}
                : {
                    stage: {
                      stage: order.erpStage.stage,
                      label: order.erpStage.label,
                      pendingSector: order.erpStage.pendingSector,
                      nunota: order.erpStage.nunota,
                      invoiceNumber: order.erpStage.invoiceNumber,
                      updatedAt: order.erpStage.updatedAt,
                      checkedAt: order.erpStage.checkedAt ?? null,
                      readError: order.erpStage.readError ?? null,
                      releaseLevel: order.erpStage.releaseLevel ?? null,
                    },
                  }),
            });
          }
          if (view.items.length === 0 || page * pageSize >= view.total) break;
        }
        return removedIds.size === 0 ? found : Object.assign(found, { removedIds: [...removedIds] });
      }),
    // RT-1: the server's change marker of the reference data; the device downloads only when it differs from the one it holds.
    fetchReferenceVersion: () => guard(async () => (await callApi(() => api.GET("/sync/status"))).referenceVersion ?? null),
    // RT-1: asks the server to re-read one order from the ERP (202; the server applies its own 10 s cooldown).
    requestOrderRefresh: (orderId) =>
      guard(async () => {
        await callApi(() => api.POST("/orders/{id}/refresh", { params: { path: { id: orderId } } }));
      }),
    // Every order of the signed-in account, wherever it was made (site, another device): the same endpoint the site lists from.
    fetchServerOrders: () =>
      guard(async () => {
        const found: ServerOrderSummary[] = [];
        const pageSize = timing.orderStatusPageSize ?? ORDER_STATUS_PAGE_SIZE;
        for (let page = 1; ; page += 1) {
          const view = await callApi(() => api.GET("/orders", { params: { query: { mine: "true", page, pageSize } } }));
          for (const order of view.items) {
            found.push({
              id: order.id,
              version: order.version,
              status: order.status,
              erpNumber: order.erpNumber,
              // The same text the site shows under "Precisa de correção" (one function, in the domain).
              deliveryError: order.status === "rejected" ? deliveryErrorText(order.erpDelivery) : null,
              createdAt: order.createdAt,
              updatedAt: order.updatedAt,
            });
          }
          if (view.items.length === 0 || page * pageSize >= view.total) break;
        }
        return found;
      }),
    // Same endpoint the site's cascade filter reads; the pull treats a failure here as non-fatal (the previous tree stays).
    // The table the server resolves the catalog against (the `priceContext` of a one-row page), kept for the list's price origin.
    fetchPricesOrigin: () =>
      guard(async () => {
        const { priceContext } = await callApi(() => api.GET("/products", { params: { query: { page: 1, pageSize: 1 } } }));
        return { source: priceContext.source, tableCode: priceContext.tableCode, tableName: priceContext.tableName };
      }),
    fetchProductGroups: () => guard(() => callApi(() => api.GET("/product-groups"))),
    // The seller's OWN discount rules only (the server never returns another seller's); best-effort in the pull.
    fetchDiscountLimits: () => guard(() => callApi(() => api.GET("/discount-limits/mine"))),
    fetchEntryConfiguration: () => guard(() => callApi(() => api.GET("/order-entry/configuration"))),
    // Same endpoint the online carrier picker uses; the pull treats a failure here as non-fatal.
    fetchCarriers: () => guard(async () => (await callApi(() => api.GET("/carriers"))).items),
    // Address lists of the new-customer form: sorted by the server, best-effort in the pull (a failure keeps the previous list).
    fetchCities: () => guard(async () => (await callApi(() => api.GET("/cities"))).items),
    fetchNeighborhoods: () => guard(async () => (await callApi(() => api.GET("/neighborhoods"))).items),
    fetchStreets: () => guard(async () => (await callApi(() => api.GET("/streets"))).items),
    fetchCustomerPriceTables: () => guard(() => callApi(() => api.GET("/customer-price-tables"))),
    fetchDatasetIdentity: () => guard(async () => datasetIdentityOf(await callApi(() => api.GET("/order-entry/configuration")))),
  };
}
