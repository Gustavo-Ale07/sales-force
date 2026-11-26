import { beforeEach, describe, expect, it } from "vitest";
import {
  META_KEYS,
  clearReferenceCache,
  getMeta,
  migrations,
  pullReferenceData,
  readSellerDiscountLimits,
  runMigrations,
  wipeLocalDatabase,
  type DatasetIdentity,
  type OfflineEnv,
  type ReferenceSource,
  type SellerDiscountLimits,
  type SqlDatabase,
} from "../src/index";
import { REAL } from "./helpers";
import { openNodeDatabase } from "./node-sqlite-connection";

const env: OfflineEnv = { now: () => new Date("2026-11-26T12:00:00.000Z"), newId: () => "id-1" };
let db: SqlDatabase;

const mine: SellerDiscountLimits = {
  sellerCode: 103,
  rules: [
    { kind: "general", code: null, percent: "8" },
    { kind: "group", code: 10, percent: "12" },
  ],
};

const sourceOf = (limits?: () => Promise<SellerDiscountLimits>, identity: DatasetIdentity = REAL): ReferenceSource => ({
  fetchCustomers: async () => [{ code: 1, name: "Cliente Um" }],
  fetchProducts: async () => [{ code: 1, description: "Tinta", groupCode: 10 }],
  fetchEntryConfiguration: async () => ({}),
  fetchDatasetIdentity: async () => identity,
  ...(limits === undefined ? {} : { fetchDiscountLimits: limits }),
});

beforeEach(async () => {
  db = openNodeDatabase();
  await runMigrations(db, migrations);
});

describe("seller discount rules on the device (offline)", () => {
  it("stores the seller's own rules with the pull and reads them back without network", async () => {
    await pullReferenceData(db, env, sourceOf(async () => mine), "acct");
    expect(await db.transaction((tx) => readSellerDiscountLimits(tx))).toEqual(mine);
  });

  it("has none when the source does not deliver them", async () => {
    await pullReferenceData(db, env, sourceOf(), "acct");
    expect(await db.transaction((tx) => readSellerDiscountLimits(tx))).toBeNull();
  });

  it("keeps the previous rules when the fetch fails for the same account and dataset, and the pull still succeeds", async () => {
    await pullReferenceData(db, env, sourceOf(async () => mine), "acct");
    await pullReferenceData(db, env, sourceOf(async () => { throw new Error("down"); }), "acct");
    expect(await db.transaction((tx) => readSellerDiscountLimits(tx))).toEqual(mine);
  });

  it("never keeps another account's rules when they cannot be refreshed", async () => {
    await pullReferenceData(db, env, sourceOf(async () => mine), "acct-a");
    await pullReferenceData(db, env, sourceOf(async () => { throw new Error("down"); }), "acct-b");
    expect(await db.transaction((tx) => readSellerDiscountLimits(tx))).toBeNull();
  });

  it("replaces the rules wholesale on the next successful pull", async () => {
    await pullReferenceData(db, env, sourceOf(async () => mine), "acct");
    await pullReferenceData(db, env, sourceOf(async () => ({ sellerCode: 103, rules: [] })), "acct");
    expect((await db.transaction((tx) => readSellerDiscountLimits(tx)))?.rules).toEqual([]);
  });

  it("is cleared with the reference cache and with a wipe", async () => {
    await pullReferenceData(db, env, sourceOf(async () => mine), "acct");
    await clearReferenceCache(db);
    expect(await getMeta(db, META_KEYS.sellerDiscountLimits)).toBeNull();
    await pullReferenceData(db, env, sourceOf(async () => mine), "acct");
    await wipeLocalDatabase(db);
    expect(await db.transaction((tx) => readSellerDiscountLimits(tx))).toBeNull();
  });
});
