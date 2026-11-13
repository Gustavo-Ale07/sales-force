import { beforeEach, describe, expect, it } from "vitest";
import {
  clearReferenceCache,
  countUnsentLocalWork,
  createPendingCustomer,
  getMeta,
  META_KEYS,
  migrations,
  replaceCustomers,
  replacePriceTables,
  replaceProducts,
  runMigrations,
  saveOrderDraft,
  setMeta,
  wipeLocalDatabase,
  type OfflineEnv,
  type PendingCustomerRequest,
  type SaveDraftInput,
  type SqlDatabase,
} from "../src/index";
import { confirm, REAL } from "./helpers";
import { openNodeDatabase } from "./node-sqlite-connection";

const OWNER = "acct-1";
const OTHER = "acct-2";
const priced = { state: "priced", unitPrice: "8.00", tableCode: 3, versionId: 1 };

let n = 0;
const env: OfflineEnv = { now: () => new Date("2026-11-13T12:00:00.000Z"), newId: () => `id-${String(++n).padStart(4, "0")}` };

const draft = (owner: string): SaveDraftInput => ({
  ownerAccountId: owner,
  customerCode: 10,
  customerName: "Cliente 10",
  negotiationTypeCode: null,
  topCode: null,
  carrierCode: null,
  notes: null,
  loadedDataset: REAL,
  items: [{ productCode: 1, description: "Produto 1", unit: "UN", quantity: "2", discountPercent: "0", priceJson: JSON.stringify(priced), groupCode: 1, groupName: "G" }],
});

const request: PendingCustomerRequest = {
  document: "123.456.789-09",
  name: "Padaria Ltda",
  tradeName: null,
  icmsClassification: "R",
  stateRegistration: null,
  phone: null,
  email: null,
  notes: null,
  addresses: [{ streetCode: 1, neighborhoodCode: 2, number: "10", complement: null, postalCode: "01001000" }],
};

let db: SqlDatabase;
const count = async (table: string) => Number((await db.query(`SELECT count(*) AS n FROM ${table}`))[0]?.n);

async function seedCache() {
  await db.transaction(async (tx) => {
    await replaceCustomers(tx, [{ code: 10, name: "Cliente 10", active: true, blocked: false, sellerCode: 1, priceTableCode: 3 } as never]);
    await replaceProducts(tx, [{ code: 1, description: "Produto 1", listPrice: priced } as never]);
    await replacePriceTables(tx, [{ tableCode: 3, prices: [{ productCode: 1, listPrice: priced as never }] }]);
    await setMeta(tx, META_KEYS.cacheOwner, OWNER, "2026-11-13T12:00:00.000Z");
    await setMeta(tx, META_KEYS.customersSyncedAt, "2026-11-13T12:00:00.000Z", "2026-11-13T12:00:00.000Z");
    await setMeta(tx, META_KEYS.account, "{}", "2026-11-13T12:00:00.000Z");
  });
}

beforeEach(async () => {
  db = openNodeDatabase();
  await runMigrations(db, migrations);
  await confirm(db);
});

describe("countUnsentLocalWork", () => {
  it("is zero with nothing local", async () => {
    expect(await countUnsentLocalWork(db, OWNER)).toBe(0);
  });

  it("counts the account's unsent orders and unsent customers, never another account's", async () => {
    await saveOrderDraft(db, env, draft(OWNER));
    await createPendingCustomer(db, env, { ownerAccountId: OWNER, request });
    await saveOrderDraft(db, env, draft(OTHER));
    expect(await countUnsentLocalWork(db, OWNER)).toBe(2);
    expect(await countUnsentLocalWork(db, OTHER)).toBe(1);
  });
});

describe("clearReferenceCache (ordinary logout with nothing pending)", () => {
  it("drops customers, products, price tables and cache bookkeeping, keeps the session identity rows and local work", async () => {
    await seedCache();
    await saveOrderDraft(db, env, draft(OWNER));
    await clearReferenceCache(db);
    expect([await count("cache_customer"), await count("cache_product"), await count("cache_table_price")]).toEqual([0, 0, 0]);
    expect(await getMeta(db, META_KEYS.cacheOwner)).toBeNull();
    expect(await getMeta(db, META_KEYS.customersSyncedAt)).toBeNull();
    expect(await getMeta(db, META_KEYS.account)).toBe("{}");
    expect(await count("local_order_draft")).toBe(1);
  });
});

describe("wipeLocalDatabase (revocation or deactivation)", () => {
  it("deletes orders, outbox, pending customers, cache and every metadata row, of every account", async () => {
    await seedCache();
    await saveOrderDraft(db, env, draft(OWNER));
    await saveOrderDraft(db, env, draft(OTHER));
    await createPendingCustomer(db, env, { ownerAccountId: OWNER, request });
    await wipeLocalDatabase(db);
    for (const table of ["cache_customer", "cache_product", "cache_table_price", "local_order_draft", "local_order_item", "outbox", "pending_customer", "sync_metadata"]) {
      expect(await count(table)).toBe(0);
    }
    expect(await countUnsentLocalWork(db, OWNER)).toBe(0);
  });

  it("leaves a usable database: the schema survives and a new draft can be saved", async () => {
    await wipeLocalDatabase(db);
    await confirm(db);
    await saveOrderDraft(db, env, draft(OWNER));
    expect(await count("local_order_draft")).toBe(1);
  });
});
