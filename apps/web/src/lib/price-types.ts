import type { ApiSchema } from "@salesforce/contracts/client";

/**
 * List price as the typed client delivers it. openapi-fetch's `Readable` helper drops properties typed exactly
 * `null` (`noPriceReason` on priced/zero, `unitPrice` on none), so response types lack them although the server
 * sends them. Reported as a contract-typing gap; this alias keeps components independent of it.
 */
export type ListPrice =
  | { state: "priced" | "zero"; unitPrice: string; tableCode: number; versionId: number }
  | { state: "none"; tableCode: number | null; versionId: number | null; noPriceReason: ApiSchema<"NoPriceReason"> };

export type ProductRow = Omit<ApiSchema<"ProductListItem">, "listPrice"> & { listPrice: ListPrice };
