import { beforeEach, describe, expect, it } from "vitest";
import { migrations, productGroups, replaceProducts, runMigrations, searchProducts, type ProductLike, type SqlDatabase } from "../src/index";
import { openNodeDatabase } from "./node-sqlite-connection";

let db: SqlDatabase;

const priced = { state: "priced" as const };
const none = { state: "none" as const };
const catalog: ProductLike[] = [
  { code: 1, description: "Tinta Acrílica 18L", groupCode: 10, groupName: "Tintas", listPrice: priced },
  { code: 2, description: "Tinta Esmalte 3,6L", groupCode: 10, groupName: "Tintas", listPrice: none },
  { code: 3, description: "Aguarrás 0,9L", groupCode: 20, groupName: "Solventes", listPrice: priced },
  { code: 4, description: "Rolo de lã", groupCode: 30, groupName: "Acessórios", listPrice: { state: "zero" } },
  { code: 5, description: "Produto sem grupo", listPrice: none },
];

beforeEach(async () => {
  db = openNodeDatabase();
  await runMigrations(db, migrations);
  await db.transaction((tx) => replaceProducts(tx, catalog));
});

const base = { search: "", page: 1, pageSize: 25 };
const descriptions = async (request: Parameters<typeof searchProducts>[1]) =>
  (await db.transaction((tx) => searchProducts<ProductLike>(tx, request))).items.map((p) => p.description);

describe("product cache filters", () => {
  it("keeps the plain search working without filters", async () => {
    expect(await descriptions({ ...base, search: "tinta" })).toEqual(["Tinta Acrílica 18L", "Tinta Esmalte 3,6L"]);
  });

  it("filters by one or several groups", async () => {
    expect(await descriptions({ ...base, filters: { groupCodes: [20] } })).toEqual(["Aguarrás 0,9L"]);
    expect(await descriptions({ ...base, filters: { groupCodes: [20, 30] } })).toEqual(["Aguarrás 0,9L", "Rolo de lã"]);
  });

  it("filters by price state: priced includes an explicit zero row, none is a missing price", async () => {
    expect(await descriptions({ ...base, filters: { priceState: "priced" } })).toEqual(["Aguarrás 0,9L", "Rolo de lã", "Tinta Acrílica 18L"]);
    expect(await descriptions({ ...base, filters: { priceState: "none" } })).toEqual(["Produto sem grupo", "Tinta Esmalte 3,6L"]);
  });

  it("combines search, group and price, and reports the filtered total", async () => {
    const page = await db.transaction((tx) => searchProducts<ProductLike>(tx, { ...base, search: "tinta", filters: { groupCodes: [10], priceState: "none" } }));
    expect(page.items.map((p) => p.description)).toEqual(["Tinta Esmalte 3,6L"]);
    expect(page.total).toBe(1);
    expect(await descriptions({ ...base, search: "tinta", filters: { groupCodes: [20] } })).toEqual([]);
  });

  it("lists the groups present in the cache with counts for the group filter, honouring search and price", async () => {
    expect(await db.transaction((tx) => productGroups(tx))).toEqual([
      { code: 30, name: "Acessórios", count: 1 },
      { code: 10, name: "Tintas", count: 2 },
      { code: 20, name: "Solventes", count: 1 },
    ].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
  });
});
