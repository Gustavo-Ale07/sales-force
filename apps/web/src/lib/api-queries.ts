import type {
  ApiPaths,
  ApiSchema,
} from "@salesforce/contracts/client";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { ApiRequestError, callApi, toApiRequestError, type ApiClient } from "./api";

/**
 * TanStack Query options for every endpoint the web app reads. Types come from the generated client; the
 * component layer never touches `fetch`. Keys start with the resource name so mutations can invalidate a family.
 */

type Query<P extends keyof ApiPaths> = ApiPaths[P] extends { get: { parameters: { query?: infer Q } } }
  ? NonNullable<Q>
  : never;

export type CustomersParams = Query<"/customers">;
export type ProductsParams = Query<"/products">;
export type OrdersParams = Query<"/orders">;
export type ReleaseQueueParams = Query<"/release-queue">;

export const queryKeys = {
  ready: ["ready"] as const,
  configuration: ["configuration"] as const,
  orderEntryConfiguration: ["order-entry-configuration"] as const,
  discountLimits: ["discount-limits"] as const,
  approvals: (page: number, pageSize: number) => ["approvals", "list", page, pageSize] as const,
  approvalsAll: ["approvals"] as const,
  releaseQueue: (params: ReleaseQueueParams) => ["release-queue", "list", params] as const,
  releaseQueueCount: ["release-queue", "count"] as const,
  dashboard: ["dashboard"] as const,
  sellers: ["sellers"] as const,
  carriers: ["carriers"] as const,
  syncRefresh: (id: string) => ["sync-refresh", id] as const,
  syncStatus: ["sync-status"] as const,
  customers: (params: CustomersParams) => ["customers", "list", params] as const,
  customerRegistrations: ["customers", "registrations"] as const,
  customer: (code: number) => ["customers", "detail", code] as const,
  customerFinancial: (code: number) => ["customers", "financial", code] as const,
  customerOrderHabits: (code: number) => ["customers", "order-habits", code] as const,
  productGroups: ["product-groups"] as const,
  products: (params: ProductsParams) => ["products", "list", params] as const,
  product: (code: number, customerCode?: number) => ["products", "detail", code, customerCode ?? null] as const,
  orders: (params: OrdersParams) => ["orders", "list", params] as const,
  order: (id: string) => ["orders", "detail", id] as const,
  ordersAll: ["orders"] as const,
  orderTemplates: (customerCode: number) => ["order-templates", "list", customerCode] as const,
  orderTemplate: (id: string) => ["order-templates", "detail", id] as const,
  orderTemplatesAll: ["order-templates"] as const,
};

export function readyQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: queryKeys.ready,
    queryFn: async (): Promise<ApiSchema<"ReadyResponse">> => {
      let result;
      try {
        result = await api.GET("/ready");
      } catch {
        throw new ApiRequestError({ status: 0, message: "Sem conexão com o servidor." });
      }
      if (result.data) return result.data;
      // 503 `not_ready` still carries the readiness body: it is an answer, not a failure of the request.
      if (result.response.status === 503 && result.error && "status" in result.error) return result.error as ApiSchema<"ReadyResponse">;
      throw toApiRequestError(result.response, result.error);
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
}

export function configurationQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: queryKeys.configuration,
    queryFn: () => callApi(() => api.GET("/configuration")),
  });
}

export function discountLimitsQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: queryKeys.discountLimits,
    queryFn: () => callApi(() => api.GET("/discount-limits")),
  });
}

export function approvalsQueryOptions(api: ApiClient, page: number, pageSize: number) {
  return queryOptions({
    queryKey: queryKeys.approvals(page, pageSize),
    queryFn: () => callApi(() => api.GET("/approvals", { params: { query: { page, pageSize } } })),
    placeholderData: keepPreviousData,
  });
}

/** "Aguardando liberação": read-only mirror of the Sankhya release lines; the server decides which sectors the caller sees. */
export function releaseQueueQueryOptions(api: ApiClient, params: ReleaseQueueParams) {
  return queryOptions({
    queryKey: queryKeys.releaseQueue(params),
    queryFn: () => callApi(() => api.GET("/release-queue", { params: { query: params } })),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** Menu counter; a 403 here is what hides the menu item (convenience only, the list endpoint enforces it too). */
export function releaseQueueCountQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: queryKeys.releaseQueueCount,
    queryFn: () => callApi(() => api.GET("/release-queue/count")),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
}

export function orderEntryConfigurationQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: queryKeys.orderEntryConfiguration,
    queryFn: () => callApi(() => api.GET("/order-entry/configuration")),
  });
}

/** Active carriers (D-C), mirrored from Sankhya; changes rarely. */
export function carriersQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: queryKeys.carriers,
    queryFn: () => callApi(() => api.GET("/carriers")),
    staleTime: 5 * 60_000,
  });
}

/** ERP address registry for the customer registration: loaded once and kept (it changes rarely). */
const REGISTRY_STALE_MS = 60 * 60_000;

export function citiesQueryOptions(api: ApiClient) {
  return queryOptions({ queryKey: ["address", "cities"] as const, queryFn: () => callApi(() => api.GET("/cities")), staleTime: REGISTRY_STALE_MS });
}

export function neighborhoodsQueryOptions(api: ApiClient) {
  return queryOptions({ queryKey: ["address", "neighborhoods"] as const, queryFn: () => callApi(() => api.GET("/neighborhoods")), staleTime: REGISTRY_STALE_MS });
}

export function streetsQueryOptions(api: ApiClient) {
  return queryOptions({ queryKey: ["address", "streets"] as const, queryFn: () => callApi(() => api.GET("/streets")), staleTime: REGISTRY_STALE_MS });
}

/** CEP already looked up stays cached for the session (memory only); a failure is not retried and is silent for the person. */
export function postalCodeQueryOptions(api: ApiClient, cep: string) {
  return queryOptions({
    queryKey: ["address", "postal-code", cep] as const,
    queryFn: () => callApi(() => api.GET("/customers/postal-code/{cep}", { params: { path: { cep } } })),
    staleTime: Infinity,
    retry: false,
  });
}

export function dashboardQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: queryKeys.dashboard,
    queryFn: () => callApi(() => api.GET("/dashboard")),
  });
}

export function sellersQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: queryKeys.sellers,
    queryFn: () => callApi(() => api.GET("/sellers")),
    staleTime: 5 * 60_000,
  });
}

export function customersQueryOptions(api: ApiClient, params: CustomersParams) {
  return queryOptions({
    queryKey: queryKeys.customers(params),
    queryFn: () => callApi(() => api.GET("/customers", { params: { query: params } })),
    placeholderData: keepPreviousData,
  });
}

export type CustomerLettersParams = Query<"/customers/letters">;

/** A-Z index: count of visible customers per initial letter, under the same filters as the list. */
export function customerLettersQueryOptions(api: ApiClient, params: CustomerLettersParams) {
  return queryOptions({
    queryKey: ["customers", "letters", params] as const,
    queryFn: () => callApi(() => api.GET("/customers/letters", { params: { query: params } })),
    placeholderData: keepPreviousData,
  });
}

/** Customers created in the Force and not yet in the ERP mirror (pending send), scoped by the server. The `customers` prefix is refreshed by the realtime hook. */
export function customerRegistrationsQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: queryKeys.customerRegistrations,
    queryFn: () => callApi(() => api.GET("/customers/registrations", { params: { query: { limit: 50 } } })),
    retry: false,
  });
}

export function customerQueryOptions(api: ApiClient, code: number) {
  return queryOptions({
    queryKey: queryKeys.customer(code),
    queryFn: () => callApi(() => api.GET("/customers/{code}", { params: { path: { code } } })),
  });
}

/** How the customer buys according to the orders recorded in Sales Force (never ERP history). */
export function customerOrderHabitsQueryOptions(api: ApiClient, code: number) {
  return queryOptions({
    queryKey: queryKeys.customerOrderHabits(code),
    queryFn: () => callApi(() => api.GET("/customers/{code}/order-habits", { params: { path: { code } } })),
    retry: false,
  });
}

/** Read-only financial area of a customer (D-I). A 404 means the installation does not show it (or the customer is out of scope). */
export function customerFinancialQueryOptions(api: ApiClient, code: number) {
  return queryOptions({
    queryKey: queryKeys.customerFinancial(code),
    queryFn: () => callApi(() => api.GET("/customers/{code}/financial", { params: { path: { code } } })),
    retry: false,
  });
}

export function productGroupsQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: queryKeys.productGroups,
    queryFn: () => callApi(() => api.GET("/product-groups")),
    staleTime: 5 * 60_000,
  });
}

export function productsQueryOptions(api: ApiClient, params: ProductsParams) {
  return queryOptions({
    queryKey: queryKeys.products(params),
    queryFn: () => callApi(() => api.GET("/products", { params: { query: params } })),
    placeholderData: keepPreviousData,
  });
}

export function productQueryOptions(api: ApiClient, code: number, customerCode?: number) {
  return queryOptions({
    queryKey: queryKeys.product(code, customerCode),
    queryFn: () =>
      callApi(() =>
        api.GET("/products/{code}", {
          params: { path: { code }, query: customerCode === undefined ? {} : { customerCode } },
        }),
      ),
  });
}

export function ordersQueryOptions(api: ApiClient, params: OrdersParams) {
  return queryOptions({
    queryKey: queryKeys.orders(params),
    queryFn: () => callApi(() => api.GET("/orders", { params: { query: params } })),
    placeholderData: keepPreviousData,
  });
}

export function orderQueryOptions(api: ApiClient, id: string) {
  return queryOptions({
    queryKey: queryKeys.order(id),
    queryFn: () => callApi(() => api.GET("/orders/{id}", { params: { path: { id } } })),
    // A delivery in progress or being verified resolves by itself: keep the screen current until it is final.
    refetchInterval: (query) => (query.state.data?.status === "unknown" || query.state.data?.status === "queued" ? 5_000 : false),
  });
}

export function orderTemplatesQueryOptions(api: ApiClient, customerCode: number) {
  return queryOptions({
    queryKey: queryKeys.orderTemplates(customerCode),
    queryFn: () => callApi(() => api.GET("/customers/{code}/order-templates", { params: { path: { code: customerCode } } })),
  });
}

export function orderTemplateQueryOptions(api: ApiClient, id: string) {
  return queryOptions({
    queryKey: queryKeys.orderTemplate(id),
    queryFn: () => callApi(() => api.GET("/order-templates/{id}", { params: { path: { id } } })),
  });
}

/** D-AB B3: age of the Sankhya data behind the screens (read from `sync_state`). */
export function syncStatusQueryOptions(api: ApiClient) {
  return queryOptions({
    queryKey: queryKeys.syncStatus,
    queryFn: () => callApi(() => api.GET("/sync/status")),
    staleTime: 60_000,
  });
}

/** D-AB B3: progress of one on-demand refresh. */
export function syncRefreshQueryOptions(api: ApiClient, id: string) {
  return queryOptions({
    queryKey: queryKeys.syncRefresh(id),
    queryFn: () => callApi(() => api.GET("/sync/refresh/{id}", { params: { path: { id } } })),
  });
}
