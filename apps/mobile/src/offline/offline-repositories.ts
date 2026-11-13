import {
  META_KEYS,
  confirmDataset,
  getCachedProduct,
  isCacheReady,
  readExpectedDataset,
  sameDataset,
  getMeta,
  isoNow,
  listPendingCustomers,
  customerLetters,
  customerSellers,
  searchCustomers,
  productGroups,
  customerPriceTableOf,
  cachedPriceTableCodes,
  searchProducts,
  setMeta,
  type OfflineEnv,
  type SqlDatabase,
} from "@salesforce/mobile-db";
import { ApiRequestError } from "../data/api";
import { PriceTableNotDownloadedError } from "../data/errors";
import { toPendingListItem } from "./pending-customers";
import { datasetIdentityOf } from "./reference-source";
import type { Carrier, CustomerListItem, OrderEntryConfiguration, ProductListItem, Repositories } from "../data/ports";

/**
 * Repositories that read the on-device cache (filled by the sync manager) and fall back to the API only when the
 * cache does not hold data for this account yet. The cache is keyed to the account that filled it: another account
 * on the same device never reads it (P-21 keeps the server the authority on scope; this only avoids leaking the
 * previous account's rows on screen before the next pull replaces them).
 */
export function createOfflineFirstRepositories(deps: {
  readonly db: SqlDatabase;
  readonly env: OfflineEnv;
  readonly ownerAccountId: string;
  readonly remote: Repositories;
}): Repositories {
  const { db, env, ownerAccountId, remote } = deps;

  /** Owner + environment + dataset id + rows (see `isCacheReady`); every cache reader below goes through it. */
  const cacheReady = () => isCacheReady(db, ownerAccountId);

  return {
    customers: {
      async list(request) {
        if (!(await cacheReady())) return remote.customers.list(request);
        const page = await searchCustomers<CustomerListItem>(db, request);
        // With a jump (startAt) the total is what is left from that row on, so "has more" stays truthful.
        const total = Math.max(0, page.total - Math.max(0, request.startAt ?? 0));
        // Customers created on this device and not yet mirrored come first on page 1, at once, without waiting for a
        // sync. They have no seller or price table, so a seller / price-table filter excludes them.
        const filters = request.filters;
        const wantsPending = (request.startAt ?? 0) === 0 && filters?.sellerCode === undefined && filters?.hasPriceTable === undefined;
        if (!wantsPending) return { items: page.items, page: page.page, pageSize: page.pageSize, total };
        const pending = (await listPendingCustomers(db, ownerAccountId, await readExpectedDataset(db), request.search)).map(toPendingListItem);
        const items = request.page <= 1 ? [...pending, ...page.items] : page.items;
        return { items, page: page.page, pageSize: page.pageSize, total: total + pending.length };
      },
      async get(code) {
        // A local customer has no server detail; the sheet is built from the list item.
        if (code < 0) throw new Error("Customer detail is not available for a pending customer");
        if (remote.customers.get === undefined) throw new Error("Customer detail is not available");
        return remote.customers.get(code);
      },
      async letters(request) {
        if (!(await cacheReady())) return [];
        return customerLetters(db, request);
      },
      async sellers() {
        if (!(await cacheReady())) return [];
        return customerSellers(db);
      },
    },
    products: {
      async list(request) {
        if (!(await cacheReady())) return remote.products.list(request);
        const { customerCode, ...local } = request;
        // The order customer's table. A customer without a table uses the base catalog; a customer WITH a table whose prices are not
        // on this device blocks product selection (never a fallback to the base catalog).
        const table = customerCode === undefined ? null : ((await customerPriceTableOf(db, customerCode)) ?? null);
        if (table !== null && !(await cachedPriceTableCodes(db)).includes(table)) throw new PriceTableNotDownloadedError();
        const page = await searchProducts<ProductListItem>(db, table !== null ? { ...local, priceTableCode: table } : local);
        return { items: page.items, page: page.page, pageSize: page.pageSize, total: page.total };
      },
      async groups() {
        if (!(await cacheReady())) return [];
        return productGroups(db);
      },
      async get(code) {
        if (await cacheReady()) {
          const cached = await getCachedProduct<ProductListItem>(db, code);
          if (cached !== null) return cached;
        }
        return remote.products.get(code);
      },
    },
    orders: {
      ...remote.orders,
      // Online: the live list, remembered for later. Offline: the list stored by the last pull or live read of this
      // account and dataset; with none, the picker simply has nothing to offer (carrier is optional).
      async listCarriers() {
        try {
          const fresh = await remote.orders.listCarriers();
          if (await cacheReady()) await setMeta(db, META_KEYS.carriers, JSON.stringify(fresh), isoNow(env));
          return fresh;
        } catch (error) {
          if (error instanceof ApiRequestError && error.isNetwork) {
            if (!(await cacheReady())) return [];
            const cached = await getMeta(db, META_KEYS.carriers);
            if (cached === null) return [];
            try {
              const parsed: unknown = JSON.parse(cached);
              return Array.isArray(parsed) ? (parsed as Carrier[]) : [];
            } catch {
              return [];
            }
          }
          throw error;
        }
      },
      async getEntryConfiguration() {
        try {
          const fresh = await remote.orders.getEntryConfiguration();
          // An online answer is the server's confirmation of the dataset (null = it cannot tell: nothing is current).
          await confirmDataset(db, datasetIdentityOf(fresh), isoNow(env));
          await setMeta(db, META_KEYS.entryConfiguration, JSON.stringify(fresh), isoNow(env));
          return fresh;
        } catch (error) {
          if (error instanceof ApiRequestError && error.isNetwork) {
            const cached = await getMeta(db, META_KEYS.entryConfiguration);
            if (cached !== null && cached !== "null") {
              // Offline, a cached configuration is used only when it declares the confirmed dataset; one saved before
              // dataset identity existed (no `dataset`) is unknown and fails closed.
              const parsed = JSON.parse(cached) as OrderEntryConfiguration;
              if (sameDataset(datasetIdentityOf(parsed), await readExpectedDataset(db))) return parsed;
            }
          }
          throw error;
        }
      },
    },
  };
}
