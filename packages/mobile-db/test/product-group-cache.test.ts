import { beforeEach, describe, expect, it } from "vitest";
import {
  META_KEYS,
  clearReferenceCache,
  getMeta,
  listProductGroupTree,
  migrations,
  pullReferenceData,
  replaceProducts,
  runMigrations,
  searchProducts,
  wipeLocalDatabase,
  type DatasetIdentity,
  type OfflineEnv,
  type ProductGroupNode,
  type ProductGroupsFetch,
  type ProductLike,
  type ReferenceSource,
  type SqlDatabase,
} from "../src/index";
import { REAL } from "./helpers";
import { openNodeDatabase } from "./node-sqlite-connection";

const env: OfflineEnv = { now: () => new Date("2026-11-25T12:00:00.000Z"), newId: () => "id-1" };
let db: SqlDatabase;

/** Tintas (10) > Esmaltes (11) > Brilhantes (12); Solventes (20) alone; product 7 sits in a hidden child of Solventes (21). */
const nodes: ProductGroupNode[] = [
  { code: 10, name: "Tintas", parentCode: null, degree: 1, hasChildren: true, subtreeCodes: [10, 11, 12] },
  { code: 11, name: "Esmaltes", parentCode: 10, degree: 2, hasChildren: true, subtreeCodes: [11, 12] },
  { code: 12, name: "Brilhantes", parentCode: 11, degree: 3, hasChildren: false, subtreeCodes: [12] },
  { code: 20, name: "Solventes", parentCode: null, degree: 1, hasChildren: false, subtreeCodes: [20, 21] },
];
const fetched: ProductGroupsFetch = { items: nodes, hierarchical: true, hasUngrouped: true };

const catalog: ProductLike[] = [
  { code: 1, description: "Tinta base", groupCode: 10 },
  { code: 2, description: "Esmalte fosco", groupCode: 11 },
  { code: 3, description: "Esmalte brilhante", groupCode: 12 },
  { code: 4, description: "Aguarras", groupCode: 20 },
  { code: 7, description: "Solvente oculto", groupCode: 21 },
  { code: 5, description: "Sem grupo nulo" },
  { code: 6, description: "Sem grupo zero", groupCode: 0 },
];

const sourceOf = (productGroups?: () => Promise<ProductGroupsFetch>, identity: DatasetIdentity = REAL): ReferenceSource => ({
  fetchCustomers: async () => [{ code: 1, name: "Cliente Um" }],
  fetchProducts: async () => catalog,
  fetchEntryConfiguration: async () => ({}),
  fetchDatasetIdentity: async () => identity,
  ...(productGroups === undefined ? {} : { fetchProductGroups: productGroups }),
});

beforeEach(async () => {
  db = openNodeDatabase();
  await runMigrations(db, migrations);
});

const names = async (groupCodes: readonly number[]) =>
  (await db.transaction((tx) => searchProducts<ProductLike>(tx, { search: "", page: 1, pageSize: 50, filters: { groupCodes } }))).items.map((p) => p.description);

describe("cache_product_group (Grupo > Subgrupo > Linha)", () => {
  it("stores the groups with the pull and reads them back as the server delivered them", async () => {
    await pullReferenceData(db, env, sourceOf(async () => fetched), "acct");
    const tree = await db.transaction((tx) => listProductGroupTree(tx));
    // Read back by name (pt-BR, normalized): Brilhantes, Esmaltes, Solventes, Tintas.
    expect(tree).toEqual({ items: [nodes[2], nodes[1], nodes[3], nodes[0]], hierarchical: true, hasUngrouped: true });
  });

  it("reports no tree when the source has no group support or never delivered one", async () => {
    await pullReferenceData(db, env, sourceOf(), "acct");
    expect(await db.transaction((tx) => listProductGroupTree(tx))).toBeNull();
  });

  it("keeps the previous groups when the group fetch fails, and the pull still succeeds", async () => {
    await pullReferenceData(db, env, sourceOf(async () => fetched), "acct");
    await pullReferenceData(db, env, sourceOf(async () => { throw new Error("down"); }), "acct");
    expect((await db.transaction((tx) => listProductGroupTree(tx)))?.items).toHaveLength(4);
  });

  it("replaces the groups wholesale on the next successful pull", async () => {
    await pullReferenceData(db, env, sourceOf(async () => fetched), "acct");
    await pullReferenceData(db, env, sourceOf(async () => ({ items: nodes.slice(3), hierarchical: false, hasUngrouped: false })), "acct");
    const tree = await db.transaction((tx) => listProductGroupTree(tx));
    expect(tree?.items.map((n) => n.code)).toEqual([20]);
    expect(tree?.hierarchical).toBe(false);
    expect(tree?.hasUngrouped).toBe(false);
  });

  it("drops groups of another dataset when they cannot be refreshed", async () => {
    await pullReferenceData(db, env, sourceOf(async () => fetched), "acct");
    await pullReferenceData(db, env, sourceOf(async () => { throw new Error("down"); }, { environment: "sandbox", datasetId: "mirror-real-001" }), "acct");
    expect(await db.transaction((tx) => listProductGroupTree(tx))).toBeNull();
  });

  it("is cleared with the reference cache and with a wipe", async () => {
    await pullReferenceData(db, env, sourceOf(async () => fetched), "acct");
    await clearReferenceCache(db);
    expect(await db.transaction((tx) => listProductGroupTree(tx))).toBeNull();
    expect(await getMeta(db, META_KEYS.productGroupsHierarchical)).toBeNull();
    await pullReferenceData(db, env, sourceOf(async () => fetched), "acct");
    await wipeLocalDatabase(db);
    expect(await db.transaction((tx) => listProductGroupTree(tx))).toBeNull();
  });
});

describe("offline filter by subtreeCodes (same set the server matches)", () => {
  beforeEach(async () => {
    await db.transaction((tx) => replaceProducts(tx, catalog));
  });

  it("a group matches itself and every descendant", async () => {
    expect(await names([10, 11, 12])).toEqual(["Esmalte brilhante", "Esmalte fosco", "Tinta base"]);
    expect(await names([11, 12])).toEqual(["Esmalte brilhante", "Esmalte fosco"]);
    expect(await names([12])).toEqual(["Esmalte brilhante"]);
  });

  it("a group matches a product in a hidden descendant (the subtree is the server's, not the visible tree)", async () => {
    expect(await names([20, 21])).toEqual(["Aguarras", "Solvente oculto"]);
  });

  it("Sem grupo (0) matches a null group and group 0", async () => {
    expect(await names([0])).toEqual(["Sem grupo nulo", "Sem grupo zero"]);
  });
});
