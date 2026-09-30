import { callApi, type ApiClient } from "./api";
import type { CustomerRepository, OrderRepository, ProductRepository, Repositories } from "./ports";

/**
 * Online adapters of the repository ports over the scoped read endpoints. The server decides which rows the
 * actor may see (P-21); nothing here filters by role. Prices are list prices as returned (P-09), never edited.
 */
export function createRemoteCustomerRepository(api: ApiClient): CustomerRepository {
  return {
    async list({ search, page, pageSize, filters }) {
      const body = await callApi(() =>
        api.GET("/customers", {
          params: {
            query: {
              search: search === "" ? undefined : search,
              page,
              pageSize,
              sort: "name",
              status: filters?.status,
              sellerCode: filters?.sellerCode,
              hasPriceTable: filters?.hasPriceTable === undefined ? undefined : filters.hasPriceTable ? "true" : "false",
            },
          },
        }),
      );
      return { items: body.items, page: body.page, pageSize: body.pageSize, total: body.total };
    },
    async get(code) {
      return callApi(() => api.GET("/customers/{code}", { params: { path: { code } } }));
    },
  };
}

export function createRemoteProductRepository(api: ApiClient): ProductRepository {
  return {
    async list({ search, page, pageSize }) {
      const body = await callApi(() =>
        api.GET("/products", {
          params: { query: { search: search === "" ? undefined : search, page, pageSize, sort: "description" } },
        }),
      );
      return { items: body.items, page: body.page, pageSize: body.pageSize, total: body.total };
    },
    async get(code) {
      return callApi(() => api.GET("/products/{code}", { params: { path: { code }, query: {} } }));
    },
  };
}

/**
 * Draft order writes (MOB-4, online-only): the same `POST /orders` / `GET /order-entry/configuration` endpoints
 * the web app uses. Prices, totals and validation are always resolved server-side (P-09); this adapter sends
 * only product, quantity and discount percentage.
 */
export function createRemoteOrderRepository(api: ApiClient): OrderRepository {
  return {
    async getEntryConfiguration() {
      return callApi(() => api.GET("/order-entry/configuration"));
    },
    async create(request) {
      return callApi(() => api.POST("/orders", { body: request }));
    },
    async get(id) {
      return callApi(() => api.GET("/orders/{id}", { params: { path: { id } } }));
    },
    async replace(id, request) {
      return callApi(() => api.PUT("/orders/{id}", { params: { path: { id } }, body: request }));
    },
  };
}

export function createRemoteRepositories(api: ApiClient): Repositories {
  return {
    customers: createRemoteCustomerRepository(api),
    products: createRemoteProductRepository(api),
    orders: createRemoteOrderRepository(api),
  };
}
