import type { ApiSchema } from "@salesforce/contracts/client";
import { asDate, asInt, asIntList, asOneOf, asPageSize, asString, compact } from "./search-params";

/**
 * URL search parameters of the list screens. Kept apart from the screens so the router can validate the
 * URL without loading a screen: the screens are lazy chunks.
 */
export interface CustomersSearch {
  search?: string;
  status?: ApiSchema<"CustomerStatusFilter">;
  sellerCode?: number;
  hasPriceTable?: "true" | "false";
  sort?: ApiSchema<"CustomerSort">;
  page?: number;
  pageSize?: number;
}

export const CUSTOMER_STATUSES = ["active", "inactive", "blocked"] as const;
export const CUSTOMER_SORTS = ["name", "-name", "code", "-code"] as const;

export function parseCustomersSearch(raw: Record<string, unknown>): CustomersSearch {
  const page = asInt(raw.page, 1);
  const pageSize = asPageSize(raw.pageSize);
  return compact({
    search: asString(raw.search),
    status: asOneOf(raw.status, CUSTOMER_STATUSES),
    sellerCode: asInt(raw.sellerCode, 0),
    hasPriceTable: asOneOf(raw.hasPriceTable === true ? "true" : raw.hasPriceTable === false ? "false" : raw.hasPriceTable, ["true", "false"] as const),
    sort: asOneOf(raw.sort, CUSTOMER_SORTS),
    page: page !== undefined && page > 1 ? page : undefined,
    pageSize: pageSize !== 25 ? pageSize : undefined,
  });
}

export interface OrdersSearch {
  search?: string;
  status?: ApiSchema<"OrderStatus">;
  customerCode?: number;
  /** Period, inclusive, as `YYYY-MM-DD` calendar dates. */
  from?: string;
  to?: string;
  /** Date the period applies to; the creation date when absent. */
  dateField?: ApiSchema<"OrderDateField">;
  /** Codes of the products the orders must contain. */
  products?: number[];
  /** How several products combine; "any" when absent. */
  productMatch?: ApiSchema<"OrderProductMatch">;
  sort?: ApiSchema<"OrderSort">;
  page?: number;
  pageSize?: number;
}

export const ORDER_STATUSES = ["draft", "cancelled", "queued", "sent", "rejected", "unknown"] as const;
export const MAX_ORDER_PRODUCTS = 20;
export const ORDER_DATE_FIELDS = ["createdAt", "updatedAt"] as const;
export const ORDER_PRODUCT_MATCHES = ["any", "all"] as const;
export const ORDER_SORTS = ["updatedAt", "-updatedAt", "draftNumber", "-draftNumber"] as const;

export function parseOrdersSearch(raw: Record<string, unknown>): OrdersSearch {
  const page = asInt(raw.page, 1);
  const pageSize = asPageSize(raw.pageSize);
  const from = asDate(raw.from);
  const to = asDate(raw.to);
  const products = asIntList(raw.products, MAX_ORDER_PRODUCTS);
  const dateField = asOneOf(raw.dateField, ORDER_DATE_FIELDS);
  const productMatch = asOneOf(raw.productMatch, ORDER_PRODUCT_MATCHES);
  return compact({
    search: asString(raw.search),
    status: asOneOf(raw.status, ORDER_STATUSES),
    customerCode: asInt(raw.customerCode, 0),
    from,
    // An inverted period would be rejected by the API: keep the start and drop the impossible end.
    to: from !== undefined && to !== undefined && to < from ? undefined : to,
    // Defaults stay out of the URL; the choices only mean something next to what they qualify.
    dateField: dateField !== undefined && dateField !== "createdAt" && (from !== undefined || to !== undefined) ? dateField : undefined,
    products,
    productMatch: productMatch === "all" && products !== undefined && products.length > 1 ? productMatch : undefined,
    sort: asOneOf(raw.sort, ORDER_SORTS),
    page: page !== undefined && page > 1 ? page : undefined,
    pageSize: pageSize !== 25 ? pageSize : undefined,
  });
}

export interface ProductsSearch {
  search?: string;
  group?: number;
  sellable?: "true" | "false";
  priceState?: ApiSchema<"ListPriceState">;
  customerCode?: number;
  sort?: ApiSchema<"ProductSort">;
  page?: number;
  pageSize?: number;
  /** Product open in the detail panel. */
  product?: number;
}

export const PRICE_STATES = ["priced", "zero", "none"] as const;
export const PRODUCT_SORTS = ["description", "-description", "code", "-code"] as const;
export const BOOLEAN_TEXT = ["true", "false"] as const;

export function parseProductsSearch(raw: Record<string, unknown>): ProductsSearch {
  const page = asInt(raw.page, 1);
  const pageSize = asPageSize(raw.pageSize);
  const sellable = raw.sellable === true ? "true" : raw.sellable === false ? "false" : raw.sellable;
  return compact({
    search: asString(raw.search),
    group: asInt(raw.group, 0),
    sellable: asOneOf(sellable, BOOLEAN_TEXT),
    priceState: asOneOf(raw.priceState, PRICE_STATES),
    customerCode: asInt(raw.customerCode, 0),
    sort: asOneOf(raw.sort, PRODUCT_SORTS),
    page: page !== undefined && page > 1 ? page : undefined,
    pageSize: pageSize !== 25 ? pageSize : undefined,
    product: asInt(raw.product, 0),
  });
}
