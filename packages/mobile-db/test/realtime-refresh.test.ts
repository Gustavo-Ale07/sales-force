import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSyncManager,
  digestOf,
  getMeta,
  mergeServerOrders,
  migrations,
  queryDrafts,
  refreshOrderErpStatuses,
  runMigrations,
  saveOrderDraft,
  countCached,
  setMeta,
  verifyAndRepairMirror,
  getOrderErpStatuses,
  type CustomerLike,
  type OfflineEnv,
  type OrderErpStatus,
  type OrderTransport,
  type ReferenceSource,
  type RemoteOrder,
  type ServerOrderSummary,
  type SqlDatabase,
} from "../src/index";
import { confirm, REAL } from "./helpers";
import { openNodeDatabase } from "./node-sqlite-connection";

const OWNER = "acct-1";
let n = 0;
let clock = new Date("2026-11-25T12:00:00.000Z");
const env: OfflineEnv = { now: () => clock, newId: () => `id-${String(++n).padStart(6, "0")}` };

const summary = (id: string, over: Partial<ServerOrderSummary> = {}): ServerOrderSummary => ({
  id, version: 1, status: "sent", erpNumber: 900, deliveryError: null, createdAt: "2026-11-20T10:00:00.000Z", updatedAt: "2026-11-21T10:00:00.000Z", ...over,
});
const remote = (id: string): RemoteOrder => ({
  id, version: 1, draftNumber: 7, customerCode: 10, customerName: "Cliente", negotiationTypeCode: null, topCode: null, carrierCode: null, freightType: "CIF", notes: null, estimatedTotal: "16.00",
  items: [{ productCode: 1, productDescription: "P", unit: "UN", quantity: "2", unitListPrice: "8.00", priceState: "priced", priceTableCode: 3, priceVersionId: 1, discountPercent: "0" }],
});
const status = (orderId: string): OrderErpStatus => ({ orderId, erpNumber: 900, code: 1, label: "Pendente", invoiceNumber: null, checkedAt: "2026-11-25T11:59:00.000Z" });

let db: SqlDatabase;
const transport = { getOrder: async (id: string) => remote(id) } as unknown as OrderTransport;
const all = () => queryDrafts(db, { ownerAccountId: OWNER, dataset: REAL }, { limit: 100, offset: 0 });
const draftInput = { ownerAccountId: OWNER, customerCode: 10, customerName: "Local", negotiationTypeCode: null, topCode: null, carrierCode: null, notes: null, loadedDataset: REAL, items: [{ productCode: 1, description: "P", unit: "UN", quantity: "1", discountPercent: "0", priceJson: "{}", groupCode: null, groupName: null }] };

beforeEach(async () => {
  db = openNodeDatabase();
  await runMigrations(db, migrations);
  await confirm(db);
  clock = new Date("2026-11-25T12:00:00.000Z");
});

describe("removed orders (RT-1)", () => {
  it("manual pull: a synced order the server no longer reports leaves the list and loses its cached ERP status; others stay", async () => {
    const source: ReferenceSource = { fetchServerOrders: async () => [summary("s-1"), summary("s-2")] } as unknown as ReferenceSource;
    await mergeServerOrders(db, env, source, transport, OWNER);
    await setMeta(db, "cache.order_erp_status.s-1", JSON.stringify(status("s-1")), "x");
    expect((await all()).rows).toHaveLength(2);

    const result = await mergeServerOrders(db, env, { fetchServerOrders: async () => [summary("s-2")] } as unknown as ReferenceSource, transport, OWNER);
    expect(result.removed).toBe(1);
    expect((await all()).rows.map((r) => r.remoteId)).toEqual(["s-2"]);
    expect(await getMeta(db, "cache.order_erp_status.s-1")).toBeNull();
    expect(await db.query("SELECT 1 FROM local_order_item WHERE draft_local_id NOT IN (SELECT local_id FROM local_order_draft)")).toHaveLength(0);
  });

  it("removedIds of the status read drop the copy in the same sync", async () => {
    await mergeServerOrders(db, env, { fetchServerOrders: async () => [summary("s-1")] } as unknown as ReferenceSource, transport, OWNER);
    await setMeta(db, "cache.order_erp_status.s-1", JSON.stringify(status("s-1")), "x");
    const answer = Object.assign([] as OrderErpStatus[], { removedIds: ["s-1"] });
    await refreshOrderErpStatuses(db, env, { fetchOrderStatuses: async () => answer }, OWNER);
    expect((await all()).rows).toHaveLength(0);
    expect(await getOrderErpStatuses(db, ["s-1"])).toHaveLength(0);
  });

  it("an order with an unsent local edit is kept, even when the server no longer reports it", async () => {
    await mergeServerOrders(db, env, { fetchServerOrders: async () => [summary("s-1", { status: "draft", erpNumber: null })] } as unknown as ReferenceSource, transport, OWNER);
    const row = (await all()).rows[0]!;
    await db.execute("INSERT INTO outbox (local_id, operation_id, idempotency_key, type, payload, state, attempts, base_version, draft_local_id, created_at, updated_at) VALUES ('op1','op1','k1','order.replace','{}','pending',0,1,?, 'x','x')", [row.localId]);
    await db.execute("UPDATE local_order_draft SET status = 'pending_sync', customer_name = 'Editado aqui' WHERE local_id = ?", [row.localId]);

    const result = await mergeServerOrders(db, env, { fetchServerOrders: async () => [] } as unknown as ReferenceSource, transport, OWNER);
    expect(result.removed).toBe(0);
    expect((await all()).rows[0]).toMatchObject({ customerName: "Editado aqui", status: "pending_sync" });

    const answer = Object.assign([] as OrderErpStatus[], { removedIds: ["s-1"] });
    await refreshOrderErpStatuses(db, env, { fetchOrderStatuses: async () => answer }, OWNER);
    expect((await all()).rows).toHaveLength(1);
  });

  it("an empty server list never wipes a device holding many settled orders (mass-delete guard)", async () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    await mergeServerOrders(db, env, { fetchServerOrders: async () => ids.map((id) => summary(id)) } as unknown as ReferenceSource, transport, OWNER);
    await mergeServerOrders(db, env, { fetchServerOrders: async () => [] } as unknown as ReferenceSource, transport, OWNER);
    expect((await all()).rows).toHaveLength(6);
  });
});

describe("mirror check (RT-1)", () => {
  const customer = (code: number): CustomerLike => ({ code, name: `C${code}`, priceTableCode: 3 }) as CustomerLike;
  const expected = { customers: [1, 2], products: [], priceTables: new Map<number, readonly number[]>() };

  it("match: nothing is repaired or reported", async () => {
    await db.transaction(async (tx) => {
      const { replaceCustomers } = await import("../src/index");
      await replaceCustomers(tx, [customer(1), customer(2)]);
    });
    const repair = vi.fn();
    const report = vi.fn();
    expect(await verifyAndRepairMirror(db, expected, repair, report)).toEqual([]);
    expect(repair).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it("mismatch (the device kept a customer the server removed): re-downloads that entity, replaces it and reports", async () => {
    const { replaceCustomers } = await import("../src/index");
    await db.transaction((tx) => replaceCustomers(tx, [customer(1), customer(2), customer(9)]));
    const report = vi.fn();
    const repaired = await verifyAndRepairMirror(
      db,
      expected,
      async (entity) => {
        expect(entity).toBe("customers");
        await db.transaction((tx) => replaceCustomers(tx, [customer(1), customer(2)]));
      },
      report,
    );
    expect(repaired).toEqual(["customers"]);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]![0]).toContain("customers");
    expect((await countCached(db)).customers).toBe(2);
  });

  it("digest is order-independent and detects a different identifier", () => {
    expect(digestOf([1, 2, 3])).toEqual(digestOf([3, 1, 2]));
    expect(digestOf([1, 2, 3])).not.toEqual(digestOf([1, 2, 4]));
  });
});

describe("automatic updates (RT-1)", () => {
  const customers = [customer(1)];
  function customer(code: number): CustomerLike {
    return { code, name: `C${code}`, priceTableCode: null } as CustomerLike;
  }
  function makeSource(version: { current: string | null }, orders: () => ServerOrderSummary[]): ReferenceSource & { downloads: number; asked: string[] } {
    const source = {
      downloads: 0,
      asked: [] as string[],
      fetchDatasetIdentity: async () => REAL,
      fetchCustomers: async () => {
        source.downloads += 1;
        return customers;
      },
      fetchProducts: async () => [],
      fetchEntryConfiguration: async () => ({ negotiationTypes: [] }),
      fetchReferenceVersion: async () => version.current,
      fetchServerOrders: async () => orders(),
      fetchOrderStatuses: async () => [],
      requestOrderRefresh: async (id: string) => {
        source.asked.push(id);
      },
    };
    return source as unknown as ReferenceSource & { downloads: number; asked: string[] };
  }
  const manager = (source: ReferenceSource) => createSyncManager({ db, env, transport, source, ownerAccountId: OWNER, internetState: () => "online" });

  it("downloads the reference data only when the server's change marker moved, without ever showing a sync phase", async () => {
    const version = { current: "v1" };
    const source = makeSource(version, () => []);
    const sync = manager(source);
    const phases: string[] = [];
    sync.subscribe((s) => phases.push(s.phase));
    await sync.backgroundRefresh!({ reference: true });
    await sync.backgroundRefresh!({ reference: true });
    expect(source.downloads).toBe(1);
    version.current = "v2";
    await sync.backgroundRefresh!({ reference: true });
    expect(source.downloads).toBe(2);
    expect(phases.every((p) => p === "idle")).toBe(true);
    expect(sync.getStatus().dataRevision).toBe(2);
  });

  it("a draft and a customer form in progress survive an automatic pull", async () => {
    const draftId = await saveOrderDraft(db, env, draftInput);
    await db.execute(
      "INSERT INTO pending_customer (client_request_id, owner_account_id, state, payload, created_at, updated_at) VALUES ('c1', ?, 'pending', '{}', 'x', 'x')",
      [OWNER],
    ).catch(() => undefined);
    const before = await db.query("SELECT local_id, customer_name, status FROM local_order_draft");
    const items = await db.query("SELECT product_code, quantity FROM local_order_item");
    const pendingBefore = await db.query("SELECT client_request_id FROM pending_customer").catch(() => []);
    const source = makeSource({ current: "v9" }, () => []);
    await manager(source).backgroundRefresh!({ reference: true, orders: true });
    expect(await db.query("SELECT local_id, customer_name, status FROM local_order_draft")).toEqual(before);
    expect(await db.query("SELECT product_code, quantity FROM local_order_item")).toEqual(items);
    expect(await db.query("SELECT client_request_id FROM pending_customer").catch(() => [])).toEqual(pendingBefore);
    expect(draftId).toBeTruthy();
    expect((await countCached(db)).customers).toBe(1);
  });

  it("asks the server to re-read open orders with a 10 s cooldown per order and a cap of 20", async () => {
    const list = Array.from({ length: 25 }, (_v, i) => summary(`o-${String(i).padStart(2, "0")}`, { updatedAt: `2026-11-21T10:${String(i).padStart(2, "0")}:00.000Z` }));
    const source = makeSource({ current: null }, () => list);
    const sync = manager(source);
    await sync.backgroundRefresh!({ orders: true });
    expect(source.asked).toHaveLength(0); // nothing held yet: the first read only merges
    await sync.backgroundRefresh!({ askServerFor: "open" });
    expect(source.asked).toHaveLength(20);
    await sync.backgroundRefresh!({ askServerFor: "open" });
    expect(source.asked).toHaveLength(20); // cooldown
    clock = new Date(clock.getTime() + 11_000);
    await sync.backgroundRefresh!({ askServerFor: "open" });
    expect(source.asked).toHaveLength(40);
  });

  it("does nothing offline", async () => {
    const source = makeSource({ current: "v1" }, () => []);
    const sync = createSyncManager({ db, env, transport, source, ownerAccountId: OWNER, internetState: () => "offline" });
    await sync.backgroundRefresh!({ reference: true, orders: true, askServerFor: "open" });
    expect(source.downloads).toBe(0);
  });
});
