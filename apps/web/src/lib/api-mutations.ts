import type { ApiSchema } from "@salesforce/contracts/client";
import { callApi, type ApiClient } from "./api";

/** Order writes. Prices and totals are always recomputed by the server; the client sends product and quantity only. */

export type CreateOrderBody = ApiSchema<"CreateOrderRequest">;
export type ReplaceOrderBody = ApiSchema<"ReplaceOrderRequest">;

export function createOrder(api: ApiClient, body: CreateOrderBody) {
  return callApi(() => api.POST("/orders", { body }));
}

export function replaceOrder(api: ApiClient, id: string, body: ReplaceOrderBody) {
  return callApi(() => api.PUT("/orders/{id}", { params: { path: { id } }, body }));
}

export function discardOrder(api: ApiClient, id: string) {
  return callApi(() => api.DELETE("/orders/{id}", { params: { path: { id } } }));
}

/** Always ends in `erp_submission_disabled` (409) until the ERP write-safety gates close. Never treated as success. */
export function submitOrder(api: ApiClient, id: string) {
  return callApi(() => api.POST("/orders/{id}/submit", { params: { path: { id } } }));
}

export const ERP_SUBMISSION_DISABLED = "erp_submission_disabled";
