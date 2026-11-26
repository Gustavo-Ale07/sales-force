import type { SqlExecutor, SqlRow } from "./connection";
import { escapeLike, normalizeSearchText } from "./offline-env";

/**
 * Address lists of the new-customer form (owner 2026-11-26): ERP cities, neighborhoods and streets, read offline, plus the postal codes
 * (CEP) already looked up. The three lists are a cache replaced as a whole by each pull (`GET /cities`, `/neighborhoods`, `/streets`);
 * search is local, case and accent blind, and returns a limited number of rows (the lists have thousands).
 */

export interface CachedCity {
  readonly code: number;
  readonly name: string;
  readonly uf: string;
  readonly ibge: string | null;
}
export interface CachedNeighborhood {
  readonly code: number;
  readonly name: string;
}
export interface CachedStreet {
  readonly code: number;
  readonly name: string;
  readonly kind: string | null;
}

/** What the server answered for a CEP that was found (the shape of `GET /customers/postal-code/{cep}`). */
export interface CachedPostalCode {
  readonly found: boolean;
  readonly postalCode: string | null;
  readonly street: string | null;
  readonly neighborhood: string | null;
  readonly city: string | null;
  readonly uf: string | null;
  readonly cityCode: number | null;
  readonly neighborhoodCode: number | null;
  readonly streetCode: number | null;
  readonly source: string | null;
}

export const ADDRESS_SEARCH_LIMIT = 50;

const rowsOf = (value: readonly unknown[]): readonly Record<string, unknown>[] => value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const nullableText = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const codeOf = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) ? value : null);

/** Replaces the whole list of cities (call inside the pull transaction). Rows without a code or a name are skipped. */
export async function replaceCities(tx: SqlExecutor, items: readonly unknown[]): Promise<number> {
  await tx.execute("DELETE FROM cache_city");
  let count = 0;
  for (const item of rowsOf(items)) {
    const code = codeOf(item.code);
    const name = text(item.name).trim();
    if (code === null || name === "") continue;
    const uf = text(item.uf).trim().toUpperCase();
    await tx.execute("INSERT OR REPLACE INTO cache_city (code, name, uf, ibge, search) VALUES (?, ?, ?, ?, ?)", [code, name, uf, nullableText(item.ibge), normalizeSearchText(`${name} ${uf}`)]);
    count += 1;
  }
  return count;
}

export async function replaceNeighborhoods(tx: SqlExecutor, items: readonly unknown[]): Promise<number> {
  await tx.execute("DELETE FROM cache_neighborhood");
  let count = 0;
  for (const item of rowsOf(items)) {
    const code = codeOf(item.code);
    const name = text(item.name).trim();
    if (code === null || name === "") continue;
    await tx.execute("INSERT OR REPLACE INTO cache_neighborhood (code, name, search) VALUES (?, ?, ?)", [code, name, normalizeSearchText(name)]);
    count += 1;
  }
  return count;
}

export async function replaceStreets(tx: SqlExecutor, items: readonly unknown[]): Promise<number> {
  await tx.execute("DELETE FROM cache_street");
  let count = 0;
  for (const item of rowsOf(items)) {
    const code = codeOf(item.code);
    const name = text(item.name).trim();
    if (code === null || name === "") continue;
    const kind = nullableText(item.kind);
    await tx.execute("INSERT OR REPLACE INTO cache_street (code, name, kind, search) VALUES (?, ?, ?, ?)", [code, name, kind, normalizeSearchText(kind === null ? name : `${kind} ${name}`)]);
    count += 1;
  }
  return count;
}

export async function clearAddressLists(tx: SqlExecutor): Promise<void> {
  await tx.execute("DELETE FROM cache_city");
  await tx.execute("DELETE FROM cache_neighborhood");
  await tx.execute("DELETE FROM cache_street");
  await tx.execute("DELETE FROM cache_postal_code");
}

/** `AND search LIKE ?` for every typed word (any order), accent and case blind. */
function termsClause(query: string): { readonly sql: string; readonly params: string[] } {
  const terms = normalizeSearchText(query).split(" ").filter((term) => term !== "");
  return { sql: terms.map(() => "AND search LIKE ? ESCAPE '\\'").join(" "), params: terms.map((term) => `%${escapeLike(term)}%`) };
}

export async function searchCities(db: SqlExecutor, query: string, limit = ADDRESS_SEARCH_LIMIT): Promise<CachedCity[]> {
  const { sql, params } = termsClause(query);
  const rows = await db.query<SqlRow>(`SELECT code, name, uf, ibge FROM cache_city WHERE 1 = 1 ${sql} ORDER BY name, uf LIMIT ?`, [...params, limit]);
  return rows.map((row) => ({ code: Number(row.code), name: String(row.name), uf: String(row.uf), ibge: row.ibge === null || row.ibge === undefined ? null : String(row.ibge) }));
}

export async function getCity(db: SqlExecutor, code: number): Promise<CachedCity | null> {
  const rows = await db.query<SqlRow>("SELECT code, name, uf, ibge FROM cache_city WHERE code = ?", [code]);
  const row = rows[0];
  return row === undefined ? null : { code: Number(row.code), name: String(row.name), uf: String(row.uf), ibge: row.ibge === null || row.ibge === undefined ? null : String(row.ibge) };
}

export async function searchNeighborhoods(db: SqlExecutor, query: string, limit = ADDRESS_SEARCH_LIMIT): Promise<CachedNeighborhood[]> {
  const { sql, params } = termsClause(query);
  const rows = await db.query<SqlRow>(`SELECT code, name FROM cache_neighborhood WHERE 1 = 1 ${sql} ORDER BY name LIMIT ?`, [...params, limit]);
  return rows.map((row) => ({ code: Number(row.code), name: String(row.name) }));
}

export async function searchStreets(db: SqlExecutor, query: string, limit = ADDRESS_SEARCH_LIMIT): Promise<CachedStreet[]> {
  const { sql, params } = termsClause(query);
  const rows = await db.query<SqlRow>(`SELECT code, name, kind FROM cache_street WHERE 1 = 1 ${sql} ORDER BY name LIMIT ?`, [...params, limit]);
  return rows.map((row) => ({ code: Number(row.code), name: String(row.name), kind: row.kind === null || row.kind === undefined ? null : String(row.kind) }));
}

/** Remembers a CEP the server found (only found ones: a miss may be a temporary failure of the sources). */
export async function putCachedPostalCode(tx: SqlExecutor, cep: string, value: CachedPostalCode, cachedAt: string): Promise<void> {
  if (!/^\d{8}$/.test(cep) || !value.found) return;
  await tx.execute(
    `INSERT INTO cache_postal_code (cep, data, cached_at) VALUES (?, ?, ?)
     ON CONFLICT(cep) DO UPDATE SET data = excluded.data, cached_at = excluded.cached_at`,
    [cep, JSON.stringify(value), cachedAt],
  );
}

export async function getCachedPostalCode(db: SqlExecutor, cep: string): Promise<CachedPostalCode | null> {
  const rows = await db.query<SqlRow>("SELECT data FROM cache_postal_code WHERE cep = ?", [cep]);
  const row = rows[0];
  if (row === undefined) return null;
  try {
    const parsed = JSON.parse(String(row.data)) as CachedPostalCode;
    return parsed.found === true ? parsed : null;
  } catch {
    return null;
  }
}
