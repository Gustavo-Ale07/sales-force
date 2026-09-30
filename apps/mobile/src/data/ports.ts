import type { ApiSchema } from "@salesforce/contracts/client";

/** Wire shapes: the generated OpenAPI types are the source of truth for what the API returns (STACK-4). */
export type CustomerListItem = ApiSchema<"CustomerListItem">;
/**
 * List price as the typed client delivers it. openapi-fetch's `Readable` helper drops properties typed exactly
 * `null` (`noPriceReason` on priced/zero, `unitPrice` on none), so response types lack them although the server
 * sends them (the same known contract-typing gap the web app works around in `price-types.ts`).
 */
export type ListPriceContext =
  | { state: "priced" | "zero"; unitPrice: string; tableCode: number; versionId: number }
  | { state: "none"; tableCode: number | null; versionId: number | null; noPriceReason: ApiSchema<"NoPriceReason"> };

export type ProductListItem = Omit<ApiSchema<"ProductListItem">, "listPrice"> & { listPrice: ListPriceContext };

/**
 * Repository ports: the only way screens read business data.
 *
 * Today the only adapters are online (`remote-repositories.ts`, the scoped read endpoints). When spike S7
 * (V-09) selects the encrypted local database (MOB-2), a local adapter reads `packages/mobile-db` behind the
 * same ports, and the sync engine (Round 5, still PROPOSED) fills it. Screens do not change. Nothing here may
 * carry cost or margin (P-20).
 */
export interface PageRequest {
  /** Free-text filter typed by the user; empty means "no filter". */
  readonly search: string;
  readonly page: number;
  readonly pageSize: number;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export type CustomerDetail = ApiSchema<"CustomerDetail">;

/** Same meaning as the API query: active = active and not blocked; inactive = not active; blocked = blocked flag. */
export interface CustomerFilters {
  readonly status?: "active" | "inactive" | "blocked";
  readonly sellerCode?: number;
  readonly hasPriceTable?: boolean;
}

export interface CustomerPageRequest extends PageRequest {
  readonly filters?: CustomerFilters;
  /** Zero-based row the list starts from (alphabetical jump). Only repositories that implement `letters` honor it. */
  readonly startAt?: number;
}

export interface CustomerLetter {
  /** `#` groups names that do not start with a letter. */
  readonly letter: string;
  readonly count: number;
  readonly offset: number;
}

export interface CustomerSellerOption {
  readonly code: number;
  readonly name: string | null;
  readonly count: number;
}

export interface CustomerRepository {
  list(request: CustomerPageRequest): Promise<Page<CustomerListItem>>;
  /** Detail fields that are not in the list item (price table name, credit limit when configured). Online only. */
  get?(code: number): Promise<CustomerDetail>;
  /** Alphabetical index of the searched/filtered list. Only where it can run in the local database. */
  letters?(request: Pick<CustomerPageRequest, "search" | "filters">): Promise<readonly CustomerLetter[]>;
  /** Sellers present in the portfolio available on this device (for the seller filter). */
  sellers?(): Promise<readonly CustomerSellerOption[]>;
}

/** Catalog filters, available only where they can run in the local database (`groups` present). */
export interface ProductFilters {
  readonly groupCodes?: readonly number[];
  /** `priced` = has a list price; `none` = "Sem preço". */
  readonly priceState?: "priced" | "none";
}

export interface ProductPageRequest extends PageRequest {
  readonly filters?: ProductFilters;
}

/** A catalog group present on this device. The ERP mirror has no group hierarchy, so the list is flat. */
export interface ProductGroupOption {
  readonly code: number;
  readonly name: string | null;
  readonly count: number;
}

export interface ProductRepository {
  list(request: ProductPageRequest): Promise<Page<ProductListItem>>;
  /** Groups of the catalog available on this device (for the group filter). Only where the local cache can compute it. */
  groups?(): Promise<readonly ProductGroupOption[]>;
  /**
   * A single product by code, detail fields included. Used to resolve the catalog group (`groupCode`/`groupName`)
   * of a cart line reopened from a saved draft (`lineFromOrderItem`), which does not carry it — mirrors
   * `apps/web`'s `productQueryOptions` lookup used by `GroupDiscountDialog` (MOB-4a).
   */
  get(code: number): Promise<ProductListItem>;
}

export type OrderEntryConfiguration = ApiSchema<"OrderEntryConfiguration">;
export type OrderDetail = ApiSchema<"OrderDetail">;
export type OrderItem = ApiSchema<"OrderItem">;
export type CreateOrderRequest = ApiSchema<"CreateOrderRequest">;
export type ReplaceOrderRequest = ApiSchema<"ReplaceOrderRequest">;

/**
 * Online-only draft order writes (MOB-4). Save always goes to the server; there is no local outbox in this
 * slice (MOB-2/V-09 still gates `packages/mobile-db`). Prices, totals and validation are always server-side.
 *
 * `replace` mirrors the web app's `PUT /orders/{id}` usage exactly: optimistic concurrency via
 * `expectedVersion`, no separate client-generated idempotency key (a stale retry surfaces `version_conflict`,
 * same as web). `get` reopens a previously-saved draft (its own version and lines) for editing.
 */
export interface OrderRepository {
  getEntryConfiguration(): Promise<OrderEntryConfiguration>;
  create(request: CreateOrderRequest): Promise<OrderDetail>;
  get(id: string): Promise<OrderDetail>;
  replace(id: string, request: ReplaceOrderRequest): Promise<OrderDetail>;
}

export interface Repositories {
  readonly customers: CustomerRepository;
  readonly products: ProductRepository;
  readonly orders: OrderRepository;
}
