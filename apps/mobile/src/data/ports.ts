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

export interface CustomerRepository {
  list(request: PageRequest): Promise<Page<CustomerListItem>>;
}

export interface ProductRepository {
  list(request: PageRequest): Promise<Page<ProductListItem>>;
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
