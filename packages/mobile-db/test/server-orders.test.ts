import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  countDraftsByGroup,
  createSyncManager,
  type ReferenceSource,
  getDraftItems,
  isSubmittedReadOnly,
  mergeServerOrders,
  migrations,
  queryDrafts,
  runMigrations,
  saveOrderDraft,
  TransportError,
  type OfflineEnv,
  type OrderTransport,
  type RemoteOrder,
  type ServerOrderSummary,
  type SqlDatabase,
} from "../src/index";
import { confirm, REAL } from "./helpers";
import { openNodeDatabase } from "./node-sqlite-connection";

const OWNER = "acct-1";
let n = 0;
const env: OfflineEnv = { now: () => new Date("2026-11-25T12:00:00.000Z"), newId: () => `id-${String(++n).padStart(6, "0")}` };

const summary = (id: string, over: Partial<ServerOrderSummary> = {}): ServerOrderSummary => ({
  id,
  version: 1,
  status: "draft",
  erpNumber: null,
  deliveryError: null,
  createdAt: "2026-11-20T10:00:00.000Z",
  updatedAt: "2026-11-21T10:00:00.000Z",
  ...over,
});

const remote = (id: string, over: Partial<RemoteOrder> = {}): RemoteOrder => ({
  id,
  version: 1,
  draftNumber: 7,
  customerCode: 10,
  customerName: "Cliente do site",
  negotiationTypeCode: null,
  topCode: null,
  carrierCode: null,
  freightType: "CIF",
  notes: null,
  estimatedTotal: "16.00",
  items: [{ productCode: 1, productDescription: "Produto 1", unit: "UN", quantity: "2", unitListPrice: "8.00", priceState: "priced", priceTableCode: 3, priceVersionId: 1, discountPercent: "0" }],
  ...over,
});

let db: SqlDatabase;
const getOrder = vi.fn<OrderTransport["getOrder"]>();
const transport = { getOrder } as unknown as OrderTransport;

const run = (list: ServerOrderSummary[]) => mergeServerOrders(db, env, { fetchServerOrders: async () => list }, transport, OWNER);
const all = () => queryDrafts(db, { ownerAccountId: OWNER, dataset: REAL }, { limit: 100, offset: 0 });

beforeEach(async () => {
  db = openNodeDatabase();
  await runMigrations(db, migrations);
  await confirm(db);
  getOrder.mockReset();
  getOrder.mockImplementation(async (id) => remote(id));
});

describe("mergeServerOrders", () => {
  it("brings an order made elsewhere onto the device with the customer name the server sent, its lines and server dates", async () => {
    await run([summary("s-1")]);
    const { rows } = await all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ remoteId: "s-1", customerName: "Cliente do site", status: "synced", sendState: null, remoteVersion: 1, createdAt: "2026-11-20T10:00:00.000Z", updatedAt: "2026-11-21T10:00:00.000Z" });
    expect((await getDraftItems(db, rows[0]!.localId)).map((i) => i.productCode)).toEqual([1]);
    expect(await db.query("SELECT 1 FROM outbox")).toHaveLength(0);
  });

  it("is idempotent: the same server order twice never makes a second row, nor a second detail read", async () => {
    await run([summary("s-1")]);
    await run([summary("s-1")]);
    expect((await all()).rows).toHaveLength(1);
    expect(getOrder).toHaveBeenCalledTimes(1);
  });

  it("an order created on this device (already holding the remote id) is never duplicated", async () => {
    const local = await saveOrderDraft(db, env, {
      ownerAccountId: OWNER, customerCode: 10, customerName: "Local", negotiationTypeCode: null, topCode: null, carrierCode: null, notes: null, loadedDataset: REAL,
      items: [{ productCode: 1, description: "P", unit: "UN", quantity: "1", discountPercent: "0", priceJson: "{}", groupCode: null, groupName: null }],
    });
    await db.execute("DELETE FROM outbox WHERE draft_local_id = ?", [local]);
    await db.execute("UPDATE local_order_draft SET remote_id = 's-1', status = 'synced', remote_version = 1 WHERE local_id = ?", [local]);
    await run([summary("s-1")]);
    expect((await all()).rows).toHaveLength(1);
    expect(getOrder).not.toHaveBeenCalled();
  });

  it("maps the server status to the groups like the server and the site: only `sent` is 'Enviados' (owner 2026-11-25)", async () => {
    await run([
      summary("a", { status: "draft" }),
      summary("b", { status: "rejected", deliveryError: "Frete não informado" }),
      summary("c", { status: "unknown" }),
      summary("d", { status: "sent", erpNumber: 900 }),
      summary("e", { status: "queued" }),
      summary("f", { status: "awaiting_approval" }),
      summary("g", { status: "approved" }),
      summary("h", { status: "approval_rejected" }),
    ]);
    const counts = await countDraftsByGroup(db, { ownerAccountId: OWNER, dataset: REAL });
    expect(counts).toEqual({ unsent: 7, sent: 1 });
    const unsent = await queryDrafts(db, { ownerAccountId: OWNER, dataset: REAL, group: "unsent" }, { limit: 10, offset: 0 });
    expect(unsent.rows.map((r) => r.remoteId).sort()).toEqual(["a", "b", "c", "e", "f", "g", "h"]);
  });

  it("a rejected order keeps the delivery error text; read-only only with a Sankhya number (same rule as before)", async () => {
    await run([summary("b", { status: "rejected", deliveryError: "Frete não informado" }), summary("c", { status: "rejected", deliveryError: "x", erpNumber: 55 }), summary("d", { status: "sent", erpNumber: 9 })]);
    const rows = (await all()).rows;
    const by = (id: string) => rows.find((r) => r.remoteId === id)!;
    expect(by("b")).toMatchObject({ sendState: "submitted", sendCode: "rejected", sendError: "Frete não informado" });
    expect(isSubmittedReadOnly(by("b"))).toBe(false);
    expect(isSubmittedReadOnly(by("c"))).toBe(true);
    expect(isSubmittedReadOnly(by("d"))).toBe(true);
    expect(by("c").erpNumber).toBe(55);
  });

  it("refreshes a held order's status and error, and its lines when the server version moved; never touches an order with a pending command", async () => {
    await run([summary("s-1")]);
    getOrder.mockImplementation(async (id) => remote(id, { version: 2, customerName: "Novo nome", items: [] }));
    await run([summary("s-1", { version: 2, status: "rejected", deliveryError: "Sem itens", updatedAt: "2026-11-22T10:00:00.000Z" })]);
    let row = (await all()).rows[0]!;
    expect(row).toMatchObject({ remoteVersion: 2, customerName: "Novo nome", sendCode: "rejected", sendError: "Sem itens", updatedAt: "2026-11-22T10:00:00.000Z" });
    expect(await getDraftItems(db, row.localId)).toHaveLength(0);

    // Local edit queued: the server copy must not overwrite it.
    await db.execute("INSERT INTO outbox (local_id, operation_id, idempotency_key, type, payload, state, attempts, base_version, draft_local_id, created_at, updated_at) VALUES ('op1','op1','k1','order.replace','{}','pending',0,2,?, 'x','x')", [row.localId]);
    await db.execute("UPDATE local_order_draft SET status = 'pending_sync', customer_name = 'Editado aqui' WHERE local_id = ?", [row.localId]);
    getOrder.mockClear();
    await run([summary("s-1", { version: 3, status: "draft" })]);
    row = (await all()).rows[0]!;
    expect(row).toMatchObject({ customerName: "Editado aqui", status: "pending_sync" });
    expect(getOrder).not.toHaveBeenCalled();
  });

  it("an order whose detail cannot be read is skipped (retried next sync); a dead session stops the merge", async () => {
    getOrder.mockImplementation(async (id) => {
      if (id === "bad") throw new TransportError("server", "x", 500);
      return remote(id);
    });
    await run([summary("bad"), summary("ok")]);
    expect((await all()).rows.map((r) => r.remoteId)).toEqual(["ok"]);
    getOrder.mockImplementation(async () => {
      throw new TransportError("auth", "x", 401);
    });
    await expect(run([summary("other")])).rejects.toMatchObject({ kind: "auth" });
  });

  it("without a confirmed dataset nothing is written", async () => {
    const fresh = openNodeDatabase();
    await runMigrations(fresh, migrations);
    await mergeServerOrders(fresh, env, { fetchServerOrders: async () => [summary("s-1")] }, transport, OWNER);
    expect(await fresh.query("SELECT 1 FROM local_order_draft")).toHaveLength(0);
  });

  it("the sync run merges the server orders in its 'orders' step; a failed read keeps what is there and never fails the run", async () => {
    const base: ReferenceSource = {
      fetchCustomers: async () => [],
      fetchProducts: async () => [],
      fetchEntryConfiguration: async () => null,
      fetchDatasetIdentity: async () => REAL,
    } as unknown as ReferenceSource;
    const manage = (source: ReferenceSource) => createSyncManager({ db, env, transport, source, ownerAccountId: OWNER, internetState: () => "online" }).sync("manual");
    const first = await manage({ ...base, fetchServerOrders: async () => [summary("s-1")] });
    expect(first.failure).toBeNull();
    expect((await all()).rows).toHaveLength(1);
    const second = await manage({ ...base, fetchServerOrders: async () => { throw new TransportError("server", "x", 503); } });
    expect(second.failure).toBeNull();
    expect((await all()).rows).toHaveLength(1);
    const dead = await manage({ ...base, fetchServerOrders: async () => { throw new TransportError("auth", "x", 401); } });
    expect(dead.phase).toBe("auth_required");
  });

  it("an order of another account on the same device is not touched", async () => {
    await run([summary("s-1")]);
    const other = await queryDrafts(db, { ownerAccountId: "acct-2", dataset: REAL }, { limit: 10, offset: 0 });
    expect(other.rows).toHaveLength(0);
  });
});
