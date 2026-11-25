import { beforeEach, describe, expect, it } from "vitest";
import {
  clearReferenceCache,
  migrations,
  pricesOriginOf,
  pullReferenceData,
  runMigrations,
  type OfflineEnv,
  type PriceOrigin,
  type ReferenceSource,
  type SqlDatabase,
} from "../src/index";
import { REAL, SANDBOX } from "./helpers";
import { openNodeDatabase } from "./node-sqlite-connection";

const env: OfflineEnv = { now: () => new Date("2026-11-25T12:00:00.000Z"), newId: () => "id-1" };
let db: SqlDatabase;

const reference: PriceOrigin = { source: "catalog_reference", tableCode: 5, tableName: "Tabela Base" };

interface Options {
  readonly identity?: typeof REAL;
  readonly origin?: () => Promise<PriceOrigin>;
  readonly names?: Record<number, string | null>;
  readonly tables?: readonly number[];
}

const sourceOf = ({ identity = REAL, origin, names = { 7: "Atacado" }, tables = [7] }: Options = {}): ReferenceSource => ({
  fetchCustomers: async () => tables.map((table) => ({ code: table, name: `Cliente ${table}`, priceTableCode: table })),
  fetchProducts: async () => [{ code: 10, description: "Produto Dez" }],
  fetchEntryConfiguration: async () => ({}),
  fetchDatasetIdentity: async () => identity,
  fetchPriceTables: async (codes) => ({
    tables: codes.map((tableCode) => ({ tableCode, tableName: names[tableCode] ?? null, prices: [{ productCode: 10, listPrice: { state: "priced", unitPrice: "1", tableCode, versionId: 1 } }] })),
    failed: [],
  }),
  ...(origin === undefined ? {} : { fetchPricesOrigin: origin }),
});

const originOf = (tableCode: number | null) => db.transaction((tx) => pricesOriginOf(tx, tableCode));

beforeEach(async () => {
  db = openNodeDatabase();
  await runMigrations(db, migrations);
});

describe("origin of the prices shown in the catalog list (same wording data as the site: table, name, kind)", () => {
  it("keeps the reference table the server resolved the catalog against", async () => {
    await pullReferenceData(db, env, sourceOf({ origin: async () => reference }), "acct");
    expect(await originOf(null)).toEqual(reference);
  });

  it("a customer's table is the customer kind, with the name the server gave the table", async () => {
    await pullReferenceData(db, env, sourceOf({ origin: async () => reference }), "acct");
    expect(await originOf(7)).toEqual({ source: "customer", tableCode: 7, tableName: "Atacado" });
  });

  it("a table without a name still names the table (name null)", async () => {
    await pullReferenceData(db, env, sourceOf({ origin: async () => reference, names: {} }), "acct");
    expect(await originOf(7)).toEqual({ source: "customer", tableCode: 7, tableName: null });
  });

  it("is unknown (null) for the catalog until a pull stored it: nothing is guessed", async () => {
    await pullReferenceData(db, env, sourceOf(), "acct");
    expect(await originOf(null)).toBeNull();
  });

  it("keeps the previous reference origin when it cannot be read, and the pull still succeeds", async () => {
    await pullReferenceData(db, env, sourceOf({ origin: async () => reference }), "acct");
    await pullReferenceData(db, env, sourceOf({ origin: async () => { throw new Error("down"); } }), "acct");
    expect(await originOf(null)).toEqual(reference);
  });

  it("drops the reference origin of another dataset when it cannot be refreshed", async () => {
    await pullReferenceData(db, env, sourceOf({ origin: async () => reference }), "acct");
    await pullReferenceData(db, env, sourceOf({ identity: SANDBOX, origin: async () => { throw new Error("down"); } }), "acct");
    expect(await originOf(null)).toBeNull();
  });

  it("forgets the name of a table no longer on the device and is cleared with the reference cache", async () => {
    await pullReferenceData(db, env, sourceOf({ origin: async () => reference, tables: [7, 8], names: { 7: "Atacado", 8: "Varejo" } }), "acct");
    await pullReferenceData(db, env, sourceOf({ origin: async () => reference, tables: [8], names: { 8: "Varejo" } }), "acct");
    expect((await originOf(7))?.tableName).toBeNull();
    expect((await originOf(8))?.tableName).toBe("Varejo");
    await clearReferenceCache(db);
    expect(await originOf(null)).toBeNull();
    expect((await originOf(8))?.tableName).toBeNull();
  });
});
