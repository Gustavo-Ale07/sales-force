import { beforeEach, describe, expect, it } from "vitest";
import {
  cachedPriceTableCodes,
  getCachedProduct,
  migrations,
  pullReferenceData,
  replacePriceTables,
  replaceProducts,
  runMigrations,
  searchProducts,
  type OfflineEnv,
  type ProductLike,
  type ReferenceSource,
  type SqlDatabase,
} from "../src/index";
import { openNodeDatabase } from "./node-sqlite-connection";

let db: SqlDatabase;

const price = (tableCode: number, unitPrice: string) => ({ state: "priced" as const, unitPrice, tableCode, versionId: tableCode * 10 });
const catalog: ProductLike[] = [
  { code: 1, description: "Tinta Acrílica", groupCode: 10, listPrice: price(5, "10.00") },
  { code: 2, description: "Tinta Esmalte", groupCode: 10, listPrice: price(5, "20.00") },
  { code: 3, description: "Aguarrás", groupCode: 20, listPrice: price(5, "30.00") },
];

beforeEach(async () => {
  db = openNodeDatabase();
  await runMigrations(db, migrations);
  await db.transaction((tx) => replaceProducts(tx, catalog));
});

const request = { search: "", page: 1, pageSize: 25 };
const listing = async (priceTableCode: number) =>
  (await db.transaction((tx) => searchProducts<ProductLike & { listPrice: { unitPrice: string; tableCode: number } }>(tx, { ...request, priceTableCode }))).items.map(
    (p) => `${p.code}:${p.listPrice.tableCode}:${p.listPrice.unitPrice}`,
  );

describe("price tables kept on the device (owner 2026-11-13)", () => {
  it("lists, for a customer's table, only the products priced there, with that table's price", async () => {
    await db.transaction((tx) =>
      replacePriceTables(tx, [
        { tableCode: 3, prices: [{ productCode: 1, listPrice: price(3, "8.00") }, { productCode: 3, listPrice: price(3, "25.00") }] },
        { tableCode: 9, prices: [{ productCode: 2, listPrice: price(9, "18.00") }] },
      ]),
    );
    expect(await listing(3)).toEqual(["3:3:25.00", "1:3:8.00"]);
    expect(await listing(9)).toEqual(["2:9:18.00"]);
    expect(await db.transaction((tx) => cachedPriceTableCodes(tx))).toEqual([3, 9]);
  });

  it("a row with a zero or missing price never makes a product orderable in that table", async () => {
    await db.transaction((tx) =>
      replacePriceTables(tx, [{ tableCode: 3, prices: [{ productCode: 1, listPrice: { state: "zero", unitPrice: "0.00", tableCode: 3, versionId: 30 } }, { productCode: 2, listPrice: { state: "none" } }] }]),
    );
    expect(await listing(3)).toEqual([]);
  });

  it("search and group filters keep working inside a table", async () => {
    await db.transaction((tx) => replacePriceTables(tx, [{ tableCode: 3, prices: catalog.map((p) => ({ productCode: p.code, listPrice: price(3, "1.00") })) }]));
    const page = await db.transaction((tx) => searchProducts<ProductLike>(tx, { ...request, search: "tinta", priceTableCode: 3, filters: { groupCodes: [10] } }));
    expect(page.items.map((p) => p.code)).toEqual([1, 2]);
    expect(page.total).toBe(2);
  });

  it("a single product read in a table has the table price, and is absent where it has none", async () => {
    await db.transaction((tx) => replacePriceTables(tx, [{ tableCode: 3, prices: [{ productCode: 1, listPrice: price(3, "8.00") }] }]));
    const inTable = await db.transaction((tx) => getCachedProduct<ProductLike & { listPrice: { unitPrice: string } }>(tx, 1, 3));
    expect(inTable?.listPrice.unitPrice).toBe("8.00");
    expect(await db.transaction((tx) => getCachedProduct(tx, 2, 3))).toBeNull();
    expect((await db.transaction((tx) => getCachedProduct<ProductLike>(tx, 2)))?.code).toBe(2);
  });

  it("replacing keeps the tables not mentioned only when told to keep them, and drops the unused", async () => {
    await db.transaction((tx) => replacePriceTables(tx, [{ tableCode: 3, prices: [{ productCode: 1, listPrice: price(3, "8.00") }] }, { tableCode: 9, prices: [{ productCode: 2, listPrice: price(9, "18.00") }] }]));
    await db.transaction((tx) => replacePriceTables(tx, [{ tableCode: 3, prices: [{ productCode: 3, listPrice: price(3, "7.00") }] }], { keepTables: [9] }));
    expect(await listing(3)).toEqual(["3:3:7.00"]);
    expect(await listing(9)).toEqual(["2:9:18.00"]);
    await db.transaction((tx) => replacePriceTables(tx, [], { keepTables: [3] }));
    expect(await db.transaction((tx) => cachedPriceTableCodes(tx))).toEqual([3]);
  });
});

describe("pull stores the tables of the visible customers", () => {
  const env: OfflineEnv = { now: () => new Date("2026-11-13T12:00:00.000Z"), newId: () => "id" } as unknown as OfflineEnv;
  const identity = { environment: "staging", datasetId: "d1" };
  const source = (over: Partial<ReferenceSource> = {}): ReferenceSource => ({
    fetchCustomers: async () => [
      { code: 1, name: "A", priceTableCode: 3 },
      { code: 2, name: "B", priceTableCode: 3 },
      { code: 3, name: "C", priceTableCode: 9 },
      { code: 4, name: "D", priceTableCode: null },
    ],
    fetchProducts: async () => catalog,
    fetchEntryConfiguration: async () => ({}),
    fetchDatasetIdentity: async () => identity,
    ...over,
  });

  it("asks once per distinct table code, never for a customer without table", async () => {
    const asked: number[][] = [];
    const result = await pullReferenceData(
      db,
      env,
      source({
        fetchPriceTables: async (codes) => {
          asked.push([...codes]);
          return { tables: codes.map((code) => ({ tableCode: code, prices: [{ productCode: 1, listPrice: price(code, "1.00") }] })), failed: [] };
        },
      }),
      "acc",
    );
    expect(asked).toEqual([[3, 9]]);
    expect(result).toMatchObject({ customers: 4, products: 3, priceTables: 2, priceRows: 2 });
    expect(await db.transaction((tx) => cachedPriceTableCodes(tx))).toEqual([3, 9]);
  });

  const seedPreviousPull = async (owner: string, datasetId = "d1") => {
    await pullReferenceData(
      db,
      env,
      source({
        fetchDatasetIdentity: async () => ({ environment: "staging", datasetId }),
        fetchPriceTables: async () => ({
          tables: [
            { tableCode: 3, prices: [{ productCode: 1, listPrice: price(3, "8.00") }] },
            { tableCode: 77, prices: [{ productCode: 1, listPrice: price(77, "1.00") }] },
          ],
          failed: [],
        }),
      }),
      owner,
    );
  };

  it("a table read by ANOTHER account is never kept for this one (price tables are not carried across owners)", async () => {
    await seedPreviousPull("acc-a");
    await pullReferenceData(db, env, source({ fetchPriceTables: async () => ({ tables: [{ tableCode: 9, prices: [{ productCode: 2, listPrice: price(9, "18.00") }] }], failed: [] }) }), "acc-b");
    expect(await db.transaction((tx) => cachedPriceTableCodes(tx))).toEqual([9]);
  });

  it("a table read under ANOTHER dataset is never kept after the dataset changed", async () => {
    await seedPreviousPull("acc", "d1");
    await pullReferenceData(
      db,
      env,
      source({ fetchDatasetIdentity: async () => ({ environment: "staging", datasetId: "d2" }), fetchPriceTables: async () => ({ tables: [{ tableCode: 9, prices: [{ productCode: 2, listPrice: price(9, "18.00") }] }], failed: [] }) }),
      "acc",
    );
    expect(await db.transaction((tx) => cachedPriceTableCodes(tx))).toEqual([9]);
  });

  it("a table whose read failed keeps its previous prices (same account and dataset) and is reported; a table no customer uses any more is dropped", async () => {
    await seedPreviousPull("acc");
    const result = await pullReferenceData(
      db,
      env,
      source({ fetchPriceTables: async () => ({ tables: [{ tableCode: 9, prices: [{ productCode: 2, listPrice: price(9, "18.00") }] }], failed: [3] }) }),
      "acc",
    );
    expect(await db.transaction((tx) => cachedPriceTableCodes(tx))).toEqual([3, 9]);
    expect(await listing(3)).toEqual(["1:3:8.00"]);
    expect(result.priceTablesFailed).toEqual([3]);
  });

  it("a failed table of ANOTHER account is not kept (nothing carried across owners)", async () => {
    await seedPreviousPull("acc-a");
    const result = await pullReferenceData(db, env, source({ fetchPriceTables: async () => ({ tables: [], failed: [3, 9] }) }), "acc-b");
    expect(await db.transaction((tx) => cachedPriceTableCodes(tx))).toEqual([]);
    expect(result.priceTablesFailed).toEqual([3, 9]);
  });

  it("a table the server no longer serves (neither read nor failed) is dropped, not kept", async () => {
    await seedPreviousPull("acc");
    await pullReferenceData(db, env, source({ fetchPriceTables: async () => ({ tables: [], failed: [] }) }), "acc");
    expect(await db.transaction((tx) => cachedPriceTableCodes(tx))).toEqual([]);
  });

  it("an error of the price source is NOT swallowed into 'no tables': the pull fails and the previous cache stays", async () => {
    await seedPreviousPull("acc");
    await expect(
      pullReferenceData(
        db,
        env,
        source({
          fetchPriceTables: async () => {
            throw new Error("boom");
          },
        }),
        "acc",
      ),
    ).rejects.toThrow("boom");
    // (77 was never used by a customer, so the seed pull already dropped it.)
    expect(await db.transaction((tx) => cachedPriceTableCodes(tx))).toEqual([3]);
    expect(await listing(3)).toEqual(["1:3:8.00"]);
  });

  it("a source without price tables leaves the pull working as before", async () => {
    const result = await pullReferenceData(db, env, source(), "acc");
    expect(result).toMatchObject({ customers: 4, products: 3, priceTables: 0 });
  });
});
