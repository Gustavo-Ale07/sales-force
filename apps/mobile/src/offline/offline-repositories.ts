import {
  META_KEYS,
  countCached,
  getCachedProduct,
  getMeta,
  isoNow,
  customerLetters,
  customerSellers,
  searchCustomers,
  searchProducts,
  setMeta,
  type OfflineEnv,
  type SqlDatabase,
} from "@salesforce/mobile-db";
import { ApiRequestError } from "../data/api";
import type { CustomerListItem, OrderEntryConfiguration, ProductListItem, Repositories } from "../data/ports";

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

  async function cacheReady(): Promise<boolean> {
    if ((await getMeta(db, META_KEYS.cacheOwner)) !== ownerAccountId) return false;
    const counts = await countCached(db);
    return counts.customers > 0 || counts.products > 0;
  }

  return {
    customers: {
      async list(request) {
        if (!(await cacheReady())) return remote.customers.list(request);
        const page = await searchCustomers<CustomerListItem>(db, request);
        // With a jump (startAt) the total is what is left from that row on, so "has more" stays truthful.
        const total = Math.max(0, page.total - Math.max(0, request.startAt ?? 0));
        return { items: page.items, page: page.page, pageSize: page.pageSize, total };
      },
      async get(code) {
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
        const page = await searchProducts<ProductListItem>(db, request);
        return { items: page.items, page: page.page, pageSize: page.pageSize, total: page.total };
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
      async getEntryConfiguration() {
        try {
          const fresh = await remote.orders.getEntryConfiguration();
          await setMeta(db, META_KEYS.entryConfiguration, JSON.stringify(fresh), isoNow(env));
          return fresh;
        } catch (error) {
          if (error instanceof ApiRequestError && error.isNetwork) {
            const cached = await getMeta(db, META_KEYS.entryConfiguration);
            if (cached !== null && cached !== "null") return JSON.parse(cached) as OrderEntryConfiguration;
          }
          throw error;
        }
      },
    },
  };
}
