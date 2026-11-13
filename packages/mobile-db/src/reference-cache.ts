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
 * `sellerCode` / `hasPriceTable` query. There is no status filter: the server sends only active, unblocked customers (D-AQ).
 */
export interface CustomerCacheFilters {
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
  readonly listPrice?: unknown;
}

/**
 * Catalog filters that run in SQLite over the cached rows (no schema change; `group_code` is already indexed).
 * No price filter (owner 2026-11-13): the server sends only products with a price above zero.
 */
export interface ProductCacheFilters {
  readonly groupCodes?: readonly number[];
}

export interface ProductCacheRequest extends CachePageRequest {
  readonly filters?: ProductCacheFilters;
  /**
   * List the catalog of this price table (the order customer's table): only products with a price above zero in it, shown with
   * that table's price. Absent = the base catalog (reference table). The caller checks `cachedPriceTableCodes` first.
   */
  readonly priceTableCode?: number;
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

/**
 * Writes one customer in the same shape the pull writes it (a customer the ERP just confirmed, before the next pull). Not a
 * replacement of the snapshot: the other rows stay. The next pull replaces the whole cache as usual.
 */
export async function upsertCustomer(tx: SqlExecutor, customer: CustomerLike): Promise<void> {
  await tx.execute("DELETE FROM cache_customer WHERE code = ?", [customer.code]);
  await insertBatches(
    tx,
    [customer],
    "code, name, sort_text, search_text, data",
    "(?, ?, ?, ?, ?)",
    (row) => [
      row.code,
      row.name,
      normalizeSearchText(row.name),
      normalizeSearchText([row.code, row.name, row.tradeName ?? "", row.document ?? ""].join(" ")),
      JSON.stringify(row),
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

function customerClause(search: string, filters: CustomerCacheFilters | undefined): { where: string; params: (string | number)[] } {
  const { conditions, params } = searchConditions(search);
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
  return { where: whereOf(conditions), params };
}

export async function searchProducts<T extends ProductLike>(tx: SqlExecutor, request: ProductCacheRequest): Promise<CachePage<T>> {
  const clause = productClause(request.search, request.filters);
  if (request.priceTableCode === undefined) return searchTable<T>(tx, "cache_product", request, clause);
  // Same conditions, qualified for the join (the base columns keep their names; the price table only adds its own).
  const joined = `cache_product p JOIN cache_table_price t ON t.product_code = p.code AND t.table_code = ? AND ${PRICED_SQL}`;
  const where = clause.where.replace(/(search_text|group_code|data)/g, "p.$1");
  const params = [request.priceTableCode, ...clause.params];
  const totalRow = (await tx.query<SqlRow>(`SELECT count(*) AS n FROM ${joined} ${where}`, params))[0];
  const rows = await tx.query<SqlRow>(
    `SELECT p.data AS data, t.price_json AS price_json FROM ${joined} ${where} ORDER BY p.sort_text, p.code LIMIT ? OFFSET ?`,
    [...params, request.pageSize, (request.page - 1) * request.pageSize],
  );
  return {
    items: rows.map((row) => ({ ...(JSON.parse(String(row.data)) as T), listPrice: JSON.parse(String(row.price_json)) as T["listPrice"] })),
    page: request.page,
    pageSize: request.pageSize,
    total: Number(totalRow?.n ?? 0),
  };
}

/** A price row that makes a product orderable: priced above zero (a zero or missing price never does). */
const PRICED_SQL = "json_extract(t.price_json, '$.state') = 'priced'";

/** One price table as delivered: the list-price context of every product that has a row in it. */
export interface PriceTableSnapshot {
  readonly tableCode: number;
  readonly prices: readonly { readonly productCode: number; readonly listPrice: unknown }[];
}

/**
 * Replaces the price rows of the given tables (each fully, in one go) and removes every table that is neither given nor in
 * `keepTables` (a table no customer uses any more). Never edited locally.
 */
export async function replacePriceTables(tx: SqlExecutor, tables: readonly PriceTableSnapshot[], options: { readonly keepTables?: readonly number[] } = {}): Promise<void> {
  const keep = new Set([...tables.map((t) => t.tableCode), ...(options.keepTables ?? [])]);
  const existing = await cachedPriceTableCodes(tx);
  for (const code of existing) if (!keep.has(code)) await tx.execute("DELETE FROM cache_table_price WHERE table_code = ?", [code]);
  for (const table of tables) {
    await tx.execute("DELETE FROM cache_table_price WHERE table_code = ?", [table.tableCode]);
    await insertBatches(
      tx,
      table.prices,
      "table_code, product_code, price_json",
      "(?, ?, ?)",
      (row) => [table.tableCode, row.productCode, JSON.stringify(row.listPrice)],
      "cache_table_price",
    );
  }
}

/** Price table of a cached customer: a code, `null` (no table: base catalog) or `undefined` (customer not on this device). */
export async function customerPriceTableOf(tx: SqlExecutor, customerCode: number): Promise<number | null | undefined> {
  const rows = await tx.query<SqlRow>("SELECT json_extract(data, '$.priceTableCode') AS table_code FROM cache_customer WHERE code = ?", [customerCode]);
  const row = rows[0];
  if (row === undefined) return undefined;
  return row.table_code === null || row.table_code === undefined ? null : Number(row.table_code);
}

/** Price tables whose prices are on this device (ascending). */
export async function cachedPriceTableCodes(tx: SqlExecutor): Promise<number[]> {
  const rows = await tx.query<SqlRow>("SELECT DISTINCT table_code FROM cache_table_price ORDER BY table_code");
  return rows.map((row) => Number(row.table_code));
}

export async function countPriceRows(tx: SqlExecutor): Promise<number> {
  return Number((await tx.query<SqlRow>("SELECT count(*) AS n FROM cache_table_price"))[0]?.n ?? 0);
}

/** Groups present in the cached catalog (flat: the ERP mirror has no group hierarchy), for the group filter. */
export async function productGroups(tx: SqlExecutor): Promise<ProductGroupEntry[]> {
  const rows = await tx.query<SqlRow>(
    `SELECT group_code, max(json_extract(data, '$.groupName')) AS group_name, count(*) AS n
     FROM cache_product WHERE group_code IS NOT NULL GROUP BY group_code ORDER BY lower(group_name), group_code`,
  );
  return rows.map((row) => ({ code: Number(row.group_code), name: row.group_name === null ? null : String(row.group_name), count: Number(row.n) }));
}

export async function getCachedProduct<T extends ProductLike>(tx: SqlExecutor, code: number, priceTableCode?: number): Promise<T | null> {
  if (priceTableCode !== undefined) {
    const rows = await tx.query<SqlRow>(
      `SELECT p.data AS data, t.price_json AS price_json FROM cache_product p JOIN cache_table_price t ON t.product_code = p.code AND t.table_code = ? AND ${PRICED_SQL} WHERE p.code = ?`,
      [priceTableCode, code],
    );
    const hit = rows[0];
    return hit === undefined ? null : ({ ...(JSON.parse(String(hit.data)) as T), listPrice: JSON.parse(String(hit.price_json)) as T["listPrice"] });
  }
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
  /** JSON array of `{code, name}` carriers (D-C), refreshed with every pull; never required for ordering. */
  carriers: "cache.carriers",
  cacheOwner: "cache.owner_account_id",
  cacheDatasetEnvironment: "cache.dataset_environment",
  cacheDatasetId: "cache.dataset_id",
  expectedDatasetEnvironment: "session.expected_dataset_environment",
  expectedDatasetId: "session.expected_dataset_id",
  account: "session.last_account",
  lastAuthAt: "session.last_online_at",
} as const;

const BLOCKED_SQL = "COALESCE(json_extract(data, '$.blocked'), 0) = 1";

/**
 * `true` when the cached customer is inactive or blocked. A customer that is not in the cache is NOT ineligible (unknown:
 * the server decides). Indicative only; authorization and eligibility stay server-side (P-21).
 */
export async function customerBlockOf(db: SqlExecutor, code: number): Promise<"customer_inactive" | "customer_blocked" | null> {
  const rows = await db.query<SqlRow>(
    `SELECT (COALESCE(json_extract(data, '$.active'), 1) = 0) AS inactive FROM cache_customer WHERE code = ? AND (COALESCE(json_extract(data, '$.active'), 1) = 0 OR ${BLOCKED_SQL}) LIMIT 1`,
    [code],
  );
  if (rows.length === 0) return null;
  return Number(rows[0]?.inactive) === 1 ? "customer_inactive" : "customer_blocked";
}

export async function isCustomerUnavailable(db: SqlExecutor, code: number): Promise<boolean> {
  const rows = await db.query<SqlRow>(
    `SELECT 1 AS hit FROM cache_customer WHERE code = ? AND (COALESCE(json_extract(data, '$.active'), 1) = 0 OR ${BLOCKED_SQL}) LIMIT 1`,
    [code],
  );
  return rows.length > 0;
}
