import { beforeEach, describe, expect, it } from "vitest";
import { META_KEYS, getMeta, migrations, pullReferenceData, runMigrations, type DatasetIdentity, type OfflineEnv, type ReferenceSource, type SqlDatabase } from "../src/index";
import { REAL, SANDBOX } from "./helpers";
import { openNodeDatabase } from "./node-sqlite-connection";

const A = "acct-A";
let db: SqlDatabase;
let seq = 0;
const env: OfflineEnv = { now: () => new Date("2026-10-30T12:00:00.000Z"), newId: () => `id-${String(++seq).padStart(4, "0")}` };

const sourceOf = (identity: DatasetIdentity, fetchCarriers?: () => Promise<readonly unknown[]>): ReferenceSource => ({
  fetchCustomers: async () => [{ code: 1, name: "Cliente Um" }],
  fetchProducts: async () => [{ code: 10, description: "Produto Dez", groupCode: 2 }],
  fetchEntryConfiguration: async () => ({}),
  fetchDatasetIdentity: async () => identity,
  ...(fetchCarriers === undefined ? {} : { fetchCarriers }),
});

beforeEach(async () => {
  db = openNodeDatabase();
  await runMigrations(db, migrations);
});

describe("carrier list cache (D-C)", () => {
  it("stores the carriers fetched with the pull", async () => {
    await pullReferenceData(db, env, sourceOf(REAL, async () => [{ code: 7, name: "Rapido" }]), A);
    expect(JSON.parse((await getMeta(db, META_KEYS.carriers)) ?? "null")).toEqual([{ code: 7, name: "Rapido" }]);
  });

  it("keeps the previous list when the carrier fetch fails, and the pull still succeeds", async () => {
    await pullReferenceData(db, env, sourceOf(REAL, async () => [{ code: 7, name: "Rapido" }]), A);
    await pullReferenceData(db, env, sourceOf(REAL, async () => { throw new Error("down"); }), A);
    expect(JSON.parse((await getMeta(db, META_KEYS.carriers)) ?? "null")).toEqual([{ code: 7, name: "Rapido" }]);
  });

  it("drops a list that belongs to another dataset when it cannot be refreshed", async () => {
    await pullReferenceData(db, env, sourceOf(REAL, async () => [{ code: 7, name: "Rapido" }]), A);
    await pullReferenceData(db, env, sourceOf(SANDBOX, async () => { throw new Error("down"); }), A);
    expect(await getMeta(db, META_KEYS.carriers)).toBeNull();
  });

  it("works with a source that has no carrier support", async () => {
    await pullReferenceData(db, env, sourceOf(REAL), A);
    expect(await getMeta(db, META_KEYS.carriers)).toBeNull();
  });
});
