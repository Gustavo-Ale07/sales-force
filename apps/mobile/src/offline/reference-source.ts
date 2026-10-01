import type { DatasetIdentity, ReferenceSource } from "@salesforce/mobile-db";
import { callApi, type ApiClient } from "../data/api";
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
export function createReferenceSource(api: ApiClient): ReferenceSource {
  const guard = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      throw toTransportError(error);
    }
  };
  return {
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
    fetchEntryConfiguration: () => guard(() => callApi(() => api.GET("/order-entry/configuration"))),
    fetchDatasetIdentity: () => guard(async () => datasetIdentityOf(await callApi(() => api.GET("/order-entry/configuration")))),
  };
}
