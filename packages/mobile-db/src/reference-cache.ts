import type { SqlExecutor, SqlRow } from "./connection";
import { escapeLike, normalizeSearchText } from "./offline-env";

/**
 * Local cache of the reference data the seller needs offline (customers, products with their list price context).
 * The server stays the authority: the cache is replaced wholesale by a successful pull and never edited locally.
 * Rows are stored as the JSON the API delivered plus normalized search/sort columns (indexed LIKE search).
 */

export interface CustomerLike {
  readonly code: number;
  readonly name: string;
  readonly tradeName?: string | null;
  readonly document?: string | null;
  readonly active?: boolean;
  readonly blocked?: boolean;
  readonly sellerCode?: number | null;
  readonly sellerName?: string | null;
  readonly priceTableCode?: number | null;
}

/**
 * Customer list filters that run inside SQLite over the cached JSON (no schema change). Same meaning as the API's
 * `status` / `sellerCode` / `hasPriceTable` query: `active` = active and not blocked; `inactive` = not active;
 * `blocked` = blocked flag set.
 */
export interface CustomerCacheFilters {
  readonly status?: "active" | "inactive" | "blocked";
  readonly sellerCode?: number;
  readonly hasPriceTable?: boolean;
}

export interface CustomerCacheRequest extends CachePageRequest {
  readonly filters?: CustomerCacheFilters;
  /** Row offset the list starts from (alphabetical jump); page 1 is the page at this offset. */
  readonly startAt?: number;
}

export interface CustomerLetterEntry {
  /** `#` groups every name that does not start with a letter. */
  readonly letter: string;
  readonly count: number;
  /** Zero-based position of the first customer of this group in the sorted, filtered list. */
  readonly offset: number;
}

export interface CustomerSellerOption {
  readonly code: number;
  readonly name: string | null;
  readonly count: number;
}

export interface ProductLike {
  readonly code: number;
  readonly description: string;
  readonly reference?: string | null;
  readonly brand?: string | null;
  readonly groupCode?: number | null;
  readonly groupName?: string | null;
  /** Only `state` is read here (price-state filter); the rest of the list price is opaque to the cache. */
  readonly listPrice?: { readonly state: string };
}

/**
 * Catalog filters that run in SQLite over the cached rows (no schema change; `group_code` is already indexed).
 * `priced` = a price row exists (an explicit zero row included); `none` = no price resolved ("Sem preço").
 */
export interface ProductCacheFilters {
  readonly groupCodes?: readonly number[];
  readonly priceState?: "priced" | "none";
}

export interface ProductCacheRequest extends CachePageRequest {
  readonly filters?: ProductCacheFilters;
}

export interface ProductGroupEntry {
  readonly code: number;
  readonly name: string | null;
  readonly count: number;
}

export interface CachePageRequest {
  readonly search: string;
  readonly page: number;
  readonly pageSize: number;
}

export interface CachePage<T> {
  readonly items: T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

const INSERT_BATCH = 100;

async function insertBatches<T>(
  tx: SqlExecutor,
  items: readonly T[],
  columns: string,
  placeholders: string,
  toParams: (item: T) => (string | number | null)[],
  table: string,
): Promise<void> {
  for (let start = 0; start < items.length; start += INSERT_BATCH) {
    const slice = items.slice(start, start + INSERT_BATCH);
    const sql = `INSERT INTO ${table} (${columns}) VALUES ${slice.map(() => placeholders).join(", ")}`;
    await tx.execute(sql, slice.flatMap(toParams));
  }
}

/** Atomically replaces the customer cache (a failed pull elsewhere leaves the previous cache untouched). */
export async function replaceCustomers(tx: SqlExecutor, customers: readonly CustomerLike[]): Promise<void> {
  await tx.execute("DELETE FROM cache_customer");
  await insertBatches(
    tx,
    customers,
    "code, name, sort_text, search_text, data",
    "(?, ?, ?, ?, ?)",
    (customer) => [
      customer.code,
      customer.name,
      normalizeSearchText(customer.name),
      normalizeSearchText([customer.code, customer.name, customer.tradeName ?? "", customer.document ?? ""].join(" ")),
      JSON.stringify(customer),
    ],
    "cache_customer",
  );
}

export async function replaceProducts(tx: SqlExecutor, products: readonly ProductLike[]): Promise<void> {
  await tx.execute("DELETE FROM cache_product");
  await insertBatches(
    tx,
    products,
    "code, description, sort_text, search_text, group_code, data",
    "(?, ?, ?, ?, ?, ?)",
    (product) => [
      product.code,
      product.description,
      normalizeSearchText(product.description),
      normalizeSearchText([product.code, product.description, product.reference ?? "", product.brand ?? ""].join(" ")),
      product.groupCode ?? null,
      JSON.stringify(product),
    ],
    "cache_product",
  );
}

function searchConditions(search: string): { conditions: string[]; params: (string | number)[] } {
  const terms = normalizeSearchText(search).split(" ").filter((term) => term !== "");
  return {
    conditions: terms.map(() => "search_text LIKE ? ESCAPE '\\'"),
    params: terms.map((term) => `%${escapeLike(term)}%`),
  };
}

function whereOf(conditions: string[]): string {
  return conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
}

function searchClause(search: string): { where: string; params: (string | number)[] } {
  const { conditions, params } = searchConditions(search);
  return { where: whereOf(conditions), params };
}

const BLOCKED_SQL = "COALESCE(json_extract(data, '$.blocked'), 0) = 1";

function customerClause(search: string, filters: CustomerCacheFilters | undefined): { where: string; params: (string | number)[] } {
  const { conditions, params } = searchConditions(search);
  if (filters?.status === "active") conditions.push(`COALESCE(json_extract(data, '$.active'), 1) = 1 AND NOT (${BLOCKED_SQL})`);
  else if (filters?.status === "inactive") conditions.push("COALESCE(json_extract(data, '$.active'), 1) = 0");
  else if (filters?.status === "blocked") conditions.push(BLOCKED_SQL);
  if (filters?.sellerCode !== undefined) {
    conditions.push("json_extract(data, '$.sellerCode') = ?");
    params.push(filters.sellerCode);
  }
  if (filters?.hasPriceTable !== undefined) {
    conditions.push(`json_extract(data, '$.priceTableCode') IS ${filters.hasPriceTable ? "NOT " : ""}NULL`);
  }
  return { where: whereOf(conditions), params };
}

async function searchTable<T>(
  tx: SqlExecutor,
  table: string,
  request: CachePageRequest,
  clause: { where: string; params: (string | number)[] } = searchClause(request.search),
  startAt = 0,
): Promise<CachePage<T>> {
  const { where, params } = clause;
  const totalRow = (await tx.query<SqlRow>(`SELECT count(*) AS n FROM ${table} ${where}`, params))[0];
  const rows = await tx.query<SqlRow>(
    `SELECT data FROM ${table} ${where} ORDER BY sort_text, code LIMIT ? OFFSET ?`,
    [...params, request.pageSize, startAt + (request.page - 1) * request.pageSize],
  );
  return {
    items: rows.map((row) => JSON.parse(String(row.data)) as T),
    page: request.page,
    pageSize: request.pageSize,
    total: Number(totalRow?.n ?? 0),
  };
}

export function searchCustomers<T extends CustomerLike>(tx: SqlExecutor, request: CustomerCacheRequest): Promise<CachePage<T>> {
  return searchTable<T>(tx, "cache_customer", request, customerClause(request.search, request.filters), Math.max(0, request.startAt ?? 0));
}

/**
 * The alphabetical index of the (searched, filtered) customer list, computed by SQLite from the sort column, so the
 * screen can jump to a letter without loading the rows before it. Returns only letters that have customers.
 */
export async function customerLetters(
  tx: SqlExecutor,
  request: Pick<CustomerCacheRequest, "search" | "filters">,
): Promise<CustomerLetterEntry[]> {
  const { where, params } = customerClause(request.search, request.filters);
  const rows = await tx.query<SqlRow>(
    `SELECT CASE WHEN substr(sort_text, 1, 1) BETWEEN 'a' AND 'z' THEN substr(sort_text, 1, 1) ELSE '#' END AS letter, count(*) AS n
     FROM cache_customer ${where} GROUP BY letter ORDER BY CASE letter WHEN '#' THEN 0 ELSE 1 END, letter`,
    params,
  );
  let offset = 0;
  return rows.map((row) => {
    const entry = { letter: String(row.letter).toUpperCase(), count: Number(row.n), offset };
    offset += entry.count;
    return entry;
  });
}

/** Sellers present in the cached portfolio, for the seller filter (the cache holds only what the API delivered to this actor). */
export async function customerSellers(tx: SqlExecutor): Promise<CustomerSellerOption[]> {
  const rows = await tx.query<SqlRow>(
    `SELECT json_extract(data, '$.sellerCode') AS seller_code, max(json_extract(data, '$.sellerName')) AS seller_name, count(*) AS n
     FROM cache_customer WHERE json_extract(data, '$.sellerCode') IS NOT NULL GROUP BY seller_code ORDER BY lower(seller_name), seller_code`,
  );
  return rows.map((row) => ({ code: Number(row.seller_code), name: row.seller_name === null ? null : String(row.seller_name), count: Number(row.n) }));
}

function productClause(search: string, filters: ProductCacheFilters | undefined): { where: string; params: (string | number)[] } {
  const { conditions, params } = searchConditions(search);
  if (filters?.groupCodes !== undefined && filters.groupCodes.length > 0) {
    conditions.push(`group_code IN (${filters.groupCodes.map(() => "?").join(", ")})`);
    params.push(...filters.groupCodes);
  }
  if (filters?.priceState === "priced") conditions.push("json_extract(data, '$.listPrice.state') IN ('priced', 'zero')");
  else if (filters?.priceState === "none") conditions.push("COALESCE(json_extract(data, '$.listPrice.state'), 'none') = 'none'");
  return { where: whereOf(conditions), params };
}

export function searchProducts<T extends ProductLike>(tx: SqlExecutor, request: ProductCacheRequest): Promise<CachePage<T>> {
  return searchTable<T>(tx, "cache_product", request, productClause(request.search, request.filters));
}

/** Groups present in the cached catalog (flat: the ERP mirror has no group hierarchy), for the group filter. */
export async function productGroups(tx: SqlExecutor): Promise<ProductGroupEntry[]> {
  const rows = await tx.query<SqlRow>(
    `SELECT group_code, max(json_extract(data, '$.groupName')) AS group_name, count(*) AS n
     FROM cache_product WHERE group_code IS NOT NULL GROUP BY group_code ORDER BY lower(group_name), group_code`,
  );
  return rows.map((row) => ({ code: Number(row.group_code), name: row.group_name === null ? null : String(row.group_name), count: Number(row.n) }));
}

export async function getCachedProduct<T extends ProductLike>(tx: SqlExecutor, code: number): Promise<T | null> {
  const rows = await tx.query<SqlRow>("SELECT data FROM cache_product WHERE code = ?", [code]);
  const row = rows[0];
  return row === undefined ? null : (JSON.parse(String(row.data)) as T);
}

export async function countCached(tx: SqlExecutor): Promise<{ customers: number; products: number }> {
  const customers = await tx.query<SqlRow>("SELECT count(*) AS n FROM cache_customer");
  const products = await tx.query<SqlRow>("SELECT count(*) AS n FROM cache_product");
  return { customers: Number(customers[0]?.n ?? 0), products: Number(products[0]?.n ?? 0) };
}

/* ---------- key/value metadata (sync_metadata) ---------- */

export async function getMeta(tx: SqlExecutor, key: string): Promise<string | null> {
  const rows = await tx.query<SqlRow>("SELECT value FROM sync_metadata WHERE key = ?", [key]);
  const row = rows[0];
  return row === undefined ? null : String(row.value);
}

export async function setMeta(tx: SqlExecutor, key: string, value: string, updatedAt: string): Promise<void> {
  await tx.execute(
    `INSERT INTO sync_metadata (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, updatedAt],
  );
}

export async function deleteMeta(tx: SqlExecutor, key: string): Promise<void> {
  await tx.execute("DELETE FROM sync_metadata WHERE key = ?", [key]);
}

export const META_KEYS = {
  customersSyncedAt: "cache.customers.synced_at",
  productsSyncedAt: "cache.products.synced_at",
  entryConfiguration: "cache.entry_configuration",
  cacheOwner: "cache.owner_account_id",
  cacheDatasetEnvironment: "cache.dataset_environment",
  cacheDatasetId: "cache.dataset_id",
  expectedDatasetEnvironment: "session.expected_dataset_environment",
  expectedDatasetId: "session.expected_dataset_id",
  account: "session.last_account",
  lastAuthAt: "session.last_online_at",
} as const;
