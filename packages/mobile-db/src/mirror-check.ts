import type { SqlExecutor, SqlRow } from "./connection";

/**
 * Device mirror check (RT-1, owner item 2): the local copy of every reference entity must equal what the server just returned. Per
 * entity the device computes a count and a hash of the identifiers; a difference triggers an automatic repair (re-download of that
 * entity, atomic replace) and is reported. The device must never keep a record the server removed.
 *
 * Until the server exposes its own digests (`GET /sync/status` carries only `referenceVersion` today) the comparison is made against
 * the data that was just downloaded.
 */
export type MirrorEntity = "customers" | "products" | "prices";

export interface MirrorDigest {
  readonly count: number;
  readonly hash: string;
}

/** FNV-1a 32-bit over the sorted identifiers: cheap, deterministic, good enough to detect drift (not a security control). */
export function digestOf(keys: Iterable<string | number>): MirrorDigest {
  const sorted = [...keys].map(String).sort();
  let hash = 0x811c9dc5;
  for (const key of sorted) {
    for (let i = 0; i < key.length; i += 1) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash ^= 0x0a;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return { count: sorted.length, hash: hash.toString(16).padStart(8, "0") };
}

/** What the server returned in a pull: identifiers only. `priceTables` lists the tables read completely (others are not compared). */
export interface ExpectedMirror {
  readonly customers: readonly number[];
  readonly products: readonly number[];
  readonly priceTables: ReadonlyMap<number, readonly number[]>;
}

const numbers = (rows: readonly SqlRow[], column: string): number[] => rows.map((row) => Number(row[column]));

/** Digest of what the device holds for one entity (prices: only the given tables). */
export async function localDigest(db: SqlExecutor, entity: MirrorEntity, tables: readonly number[] = []): Promise<MirrorDigest> {
  if (entity === "customers") return digestOf(numbers(await db.query<SqlRow>("SELECT code FROM cache_customer"), "code"));
  if (entity === "products") return digestOf(numbers(await db.query<SqlRow>("SELECT code FROM cache_product"), "code"));
  const keys: string[] = [];
  for (const table of tables) {
    const rows = await db.query<SqlRow>("SELECT product_code FROM cache_table_price WHERE table_code = ?", [table]);
    for (const row of rows) keys.push(`${table}:${Number(row.product_code)}`);
  }
  return digestOf(keys);
}

export function expectedDigest(expected: ExpectedMirror, entity: MirrorEntity): MirrorDigest {
  if (entity === "customers") return digestOf(expected.customers);
  if (entity === "products") return digestOf(expected.products);
  const keys: string[] = [];
  for (const [table, products] of expected.priceTables) for (const product of products) keys.push(`${table}:${product}`);
  return digestOf(keys);
}

export interface MirrorMismatch {
  readonly entity: MirrorEntity;
  readonly expected: MirrorDigest;
  readonly local: MirrorDigest;
}

/** Entities whose local digest differs from the expected one. Empty = the device mirrors the server. */
export async function findMirrorMismatches(db: SqlExecutor, expected: ExpectedMirror): Promise<MirrorMismatch[]> {
  const found: MirrorMismatch[] = [];
  for (const entity of ["customers", "products", "prices"] as const) {
    const want = expectedDigest(expected, entity);
    const have = await localDigest(db, entity, entity === "prices" ? [...expected.priceTables.keys()] : []);
    if (want.count !== have.count || want.hash !== have.hash) found.push({ entity, expected: want, local: have });
  }
  return found;
}

/**
 * Compares and repairs. `repair` re-downloads one entity and replaces it atomically; it is called once per mismatching entity, then
 * the entity is compared again. `onMismatch` receives a log-safe description (counts and hashes only, never records).
 * Returns the entities that were repaired; a repair that does not converge is reported and left for the next pull.
 */
export async function verifyAndRepairMirror(
  db: SqlExecutor,
  initial: ExpectedMirror,
  repair: (entity: MirrorEntity) => Promise<Partial<ExpectedMirror> | void>,
  onMismatch: (message: string) => void,
): Promise<MirrorEntity[]> {
  const repaired: MirrorEntity[] = [];
  let expected = initial;
  for (const mismatch of await findMirrorMismatches(db, expected)) {
    onMismatch(`mirror mismatch ${mismatch.entity}: expected ${mismatch.expected.count}/${mismatch.expected.hash}, local ${mismatch.local.count}/${mismatch.local.hash}`);
    // The repair re-reads the server, which may have moved meanwhile: what it returns becomes the new expectation.
    const fresh = await repair(mismatch.entity);
    if (fresh !== undefined) expected = { ...expected, ...fresh };
    const again = (await findMirrorMismatches(db, expected)).find((m) => m.entity === mismatch.entity);
    if (again === undefined) repaired.push(mismatch.entity);
    else onMismatch(`mirror repair of ${mismatch.entity} did not converge: local ${again.local.count}/${again.local.hash}`);
  }
  return repaired;
}
