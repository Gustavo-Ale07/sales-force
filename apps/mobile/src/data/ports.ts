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

export interface Repositories {
  readonly customers: CustomerRepository;
  readonly products: ProductRepository;
}
