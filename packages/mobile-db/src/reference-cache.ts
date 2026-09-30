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
}

export interface ProductLike {
  readonly code: number;
  readonly description: string;
  readonly reference?: string | null;
  readonly brand?: string | null;
  readonly groupCode?: number | null;
  readonly groupName?: string | null;
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

function searchClause(search: string): { where: string; params: string[] } {
  const terms = normalizeSearchText(search).split(" ").filter((term) => term !== "");
  if (terms.length === 0) return { where: "", params: [] };
  return {
    where: `WHERE ${terms.map(() => "search_text LIKE ? ESCAPE '\\'").join(" AND ")}`,
    params: terms.map((term) => `%${escapeLike(term)}%`),
  };
}

async function searchTable<T>(tx: SqlExecutor, table: string, request: CachePageRequest): Promise<CachePage<T>> {
  const { where, params } = searchClause(request.search);
  const totalRow = (await tx.query<SqlRow>(`SELECT count(*) AS n FROM ${table} ${where}`, params))[0];
  const rows = await tx.query<SqlRow>(
    `SELECT data FROM ${table} ${where} ORDER BY sort_text, code LIMIT ? OFFSET ?`,
    [...params, request.pageSize, (request.page - 1) * request.pageSize],
  );
  return {
    items: rows.map((row) => JSON.parse(String(row.data)) as T),
    page: request.page,
    pageSize: request.pageSize,
    total: Number(totalRow?.n ?? 0),
  };
}

export function searchCustomers<T extends CustomerLike>(tx: SqlExecutor, request: CachePageRequest): Promise<CachePage<T>> {
  return searchTable<T>(tx, "cache_customer", request);
}

export function searchProducts<T extends ProductLike>(tx: SqlExecutor, request: CachePageRequest): Promise<CachePage<T>> {
  return searchTable<T>(tx, "cache_product", request);
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
  account: "session.last_account",
  lastAuthAt: "session.last_online_at",
} as const;
