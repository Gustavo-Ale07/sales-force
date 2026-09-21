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

export const queryKeys = {
  ready: ["ready"] as const,
  configuration: ["configuration"] as const,
  dashboard: ["dashboard"] as const,
  sellers: ["sellers"] as const,
  customers: (params: CustomersParams) => ["customers", "list", params] as const,
  customer: (code: number) => ["customers", "detail", code] as const,
  productGroups: ["product-groups"] as const,
  products: (params: ProductsParams) => ["products", "list", params] as const,
  product: (code: number, customerCode?: number) => ["products", "detail", code, customerCode ?? null] as const,
  orders: (params: OrdersParams) => ["orders", "list", params] as const,
  order: (id: string) => ["orders", "detail", id] as const,
  ordersAll: ["orders"] as const,
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

export function customerQueryOptions(api: ApiClient, code: number) {
  return queryOptions({
    queryKey: queryKeys.customer(code),
    queryFn: () => callApi(() => api.GET("/customers/{code}", { params: { path: { code } } })),
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
  });
}
