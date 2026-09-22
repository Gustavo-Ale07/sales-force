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

export type ResolveProductsBody = ApiSchema<"ResolveProductsRequest">;

/** Read-only batch lookup of pasted identifiers (a POST only because the list does not fit a query string). */
export function resolveProducts(api: ApiClient, body: ResolveProductsBody) {
  return callApi(() => api.POST("/product-resolutions", { body }));
}

/** Recurring order templates: product + quantity only. Prices are always resolved by the server when a template is used. */

export type CreateOrderTemplateBody = ApiSchema<"CreateOrderTemplateRequest">;
export type ReplaceOrderTemplateBody = ApiSchema<"ReplaceOrderTemplateRequest">;
export type UseOrderTemplateBody = ApiSchema<"UseOrderTemplateRequest">;

export function createOrderTemplate(api: ApiClient, customerCode: number, body: CreateOrderTemplateBody) {
  return callApi(() => api.POST("/customers/{code}/order-templates", { params: { path: { code: customerCode } }, body }));
}

export function replaceOrderTemplate(api: ApiClient, id: string, body: ReplaceOrderTemplateBody) {
  return callApi(() => api.PUT("/order-templates/{id}", { params: { path: { id } }, body }));
}

export function deleteOrderTemplate(api: ApiClient, id: string) {
  return callApi(() => api.DELETE("/order-templates/{id}", { params: { path: { id } } }));
}

export function createOrderFromTemplate(api: ApiClient, id: string, body: UseOrderTemplateBody) {
  return callApi(() => api.POST("/order-templates/{id}/use", { params: { path: { id } }, body }));
}

export const TEMPLATE_NAME_TAKEN = "template_name_taken";
export const TEMPLATE_LIMIT_REACHED = "template_limit_reached";
export const TEMPLATE_NO_USABLE_LINES = "no_usable_lines";

/**
 * "Repetir último pedido": a brand-new, independent draft from the customer's most recent NON-cancelled order
 * recorded in Sales Force (never Sankhya/ERP history, which is not mirrored here). Only product + quantity are
 * copied; prices are always resolved by the server. Shares its `no_usable_lines` conflict with order templates
 * (same `skippedLines` shape, same classification), so it reuses `TEMPLATE_NO_USABLE_LINES` rather than a duplicate
 * constant.
 */
export type RepeatLastOrderBody = ApiSchema<"RepeatLastOrderRequest">;

export function repeatLastOrder(api: ApiClient, customerCode: number, body: RepeatLastOrderBody) {
  return callApi(() => api.POST("/customers/{code}/orders/repeat-last", { params: { path: { code: customerCode } }, body }));
}

/** 409: the customer has no previous order recorded in Sales Force at all (an expected empty state, not a system error). */
export const NO_PREVIOUS_ORDER = "no_previous_order";
