import { describe, expect, it } from "vitest";
import {
  getCachedProduct,
  getDraft,
  getDraftItems,
  migrations,
  replaceProducts,
  runMigrations,
  saveOrderDraft,
  type OfflineEnv,
  type ProductLike,
  type SqlDatabase,
} from "../src/index";
import { confirm, REAL } from "./helpers";
import { openNodeDatabase } from "./node-sqlite-connection";

const OWNER = "acct-1";
let seq = 0;
const env: OfflineEnv = { now: () => new Date("2026-11-23T12:00:00.000Z"), newId: () => `id-${String(++seq).padStart(4, "0")}` };

async function open(): Promise<SqlDatabase> {
  const db = openNodeDatabase();
  await runMigrations(db, migrations);
  await confirm(db);
  return db;
}

const item = (extra: Record<string, unknown> = {}) => ({
  productCode: 4158,
  description: "P",
  unit: "UN",
  quantity: "1",
  discountPercent: "15",
  priceJson: "{}",
  groupCode: null,
  groupName: null,
  ...extra,
});

const order = (extra: Record<string, unknown> = {}) => ({
  ownerAccountId: OWNER,
  customerCode: 1,
  customerName: "Ana",
  negotiationTypeCode: null,
  notes: null,
  items: [item({ maxDiscountPercent: "12" })],
  loadedDataset: REAL,
  ...extra,
});

describe("product discount limit (migration 13)", () => {
  it("adds the nullable limit column and the defaulted mark, expand-only", async () => {
    const db = openNodeDatabase();
    await runMigrations(db, migrations);
    const itemColumns = await db.query<{ name: string; notnull: number }>("PRAGMA table_info(local_order_item)");
    expect(itemColumns.find((c) => c.name === "max_discount_percent")?.notnull).toBe(0);
    const draftColumns = await db.query<{ name: string; dflt_value: string }>("PRAGMA table_info(local_order_draft)");
    expect(draftColumns.find((c) => c.name === "discount_over_limit_accepted")?.dflt_value).toBe("0");
  });

  it("carries the catalog limit from the pull into the local product catalog; rows without it read as no limit", async () => {
    const db = await open();
    const catalog: ProductLike[] = [
      { code: 4158, description: "A", listPrice: { state: "priced" }, maxDiscountPercent: "12" } as ProductLike,
      { code: 9999, description: "Old row", listPrice: { state: "priced" } },
    ];
    await db.transaction((tx) => replaceProducts(tx, catalog));
    const withLimit = await db.transaction((tx) => getCachedProduct<ProductLike & { maxDiscountPercent?: string | null }>(tx, 4158));
    const without = await db.transaction((tx) => getCachedProduct<ProductLike & { maxDiscountPercent?: string | null }>(tx, 9999));
    expect(withLimit?.maxDiscountPercent).toBe("12");
    expect(without?.maxDiscountPercent ?? null).toBeNull();
  });

  it("stores the limit on each order line and reads it back; a line without it reads null", async () => {
    const db = await open();
    const id = await saveOrderDraft(db, env, order({ items: [item({ maxDiscountPercent: "12" }), item({ productCode: 1439 })] }));
    const items = await getDraftItems(db, id);
    expect(items.map((i) => i.maxDiscountPercent)).toEqual(["12", null]);
  });

  it("a new draft starts unmarked; the mark is written once, persists across edits and is never cleared", async () => {
    const db = await open();
    const id = await saveOrderDraft(db, env, order());
    expect((await getDraft(db, id))?.discountOverLimitAccepted).toBe(false);
    await saveOrderDraft(db, env, order({ localId: id, discountOverLimitAccepted: true }));
    expect((await getDraft(db, id))?.discountOverLimitAccepted).toBe(true);
    await saveOrderDraft(db, env, order({ localId: id, notes: "x" }));
    expect((await getDraft(db, id))?.discountOverLimitAccepted).toBe(true);
    await saveOrderDraft(db, env, order({ localId: id, discountOverLimitAccepted: false }));
    expect((await getDraft(db, id))?.discountOverLimitAccepted).toBe(true);
  });

  it("a draft created with the mark keeps it, and the mark never blocks confirming the order", async () => {
    const db = await open();
    const id = await saveOrderDraft(db, env, order({ discountOverLimitAccepted: true, sendRequested: true }));
    expect(await getDraft(db, id)).toMatchObject({ discountOverLimitAccepted: true, sendState: "requested" });
  });
});
