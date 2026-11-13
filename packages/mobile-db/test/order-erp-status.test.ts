import { beforeEach, describe, expect, it } from "vitest";
import {
  createSyncManager,
  getOrderErpStatuses,
  migrations,
  refreshOrderErpStatuses,
  runMigrations,
  saveOrderDraft,
  TransportError,
  wipeLocalDatabase,
  type OfflineEnv,
  type OrderErpStatus,
  type OrderTransport,
  type ReferenceSource,
  type SaveDraftInput,
  type SqlDatabase,
} from "../src/index";
import { confirm, REAL } from "./helpers";
import { openNodeDatabase } from "./node-sqlite-connection";

const OWNER = "acct-1";
const OTHER = "acct-2";
let n = 0;
const env: OfflineEnv = { now: () => new Date("2026-11-13T12:00:00.000Z"), newId: () => `id-${String(++n).padStart(6, "0")}` };

const draft = (owner: string): SaveDraftInput => ({
  ownerAccountId: owner,
  customerCode: 10,
  customerName: "Cliente 10",
  negotiationTypeCode: null,
  topCode: null,
  carrierCode: null,
  notes: null,
  loadedDataset: REAL,
  items: [{ productCode: 1, description: "Produto 1", unit: "UN", quantity: "2", discountPercent: "0", priceJson: JSON.stringify({ state: "priced", unitPrice: "8.00", tableCode: 3, versionId: 1 }), groupCode: 1, groupName: "G" }],
});

const status = (orderId: string, over: Partial<OrderErpStatus> = {}): OrderErpStatus => ({
  orderId,
  erpNumber: 900,
  code: 2,
  label: "Em análise",
  invoiceNumber: null,
  checkedAt: "2026-11-13T11:59:00.000Z",
  ...over,
});

let db: SqlDatabase;
const hold = async (owner: string, remoteId: string | null) => {
  const saved = await saveOrderDraft(db, env, draft(owner));
  if (remoteId !== null) await db.execute("DELETE FROM outbox WHERE draft_local_id = ?", [saved]);
  if (remoteId !== null) await db.execute("UPDATE local_order_draft SET remote_id = ?, status = 'synced' WHERE local_id = ?", [remoteId, saved]);
};

beforeEach(async () => {
  db = openNodeDatabase();
  await runMigrations(db, migrations);
  await confirm(db);
});

describe("refreshOrderErpStatuses (GET /orders?ids=)", () => {
  it("asks only for the server ids of this account's orders, never for local-only ones or another account's", async () => {
    await hold(OWNER, "o-1");
    await hold(OWNER, null);
    await hold(OTHER, "o-other");
    const asked: string[][] = [];
    await refreshOrderErpStatuses(db, env, { fetchOrderStatuses: async (ids) => (asked.push([...ids]), [status("o-1")]) }, OWNER);
    expect(asked).toEqual([["o-1"]]);
    expect(await getOrderErpStatuses(db, ["o-1"])).toEqual([status("o-1")]);
  });

  it("asks in chunks of at most 100 ids (the server limit)", async () => {
    for (let i = 0; i < 230; i += 1) await hold(OWNER, `o-${i}`);
    const sizes: number[] = [];
    await refreshOrderErpStatuses(db, env, { fetchOrderStatuses: async (ids) => (sizes.push(ids.length), []) }, OWNER);
    expect(sizes).toEqual([100, 100, 30]);
  });

  it("an order the server no longer returns (outside the scope) loses its stored status", async () => {
    await hold(OWNER, "o-1");
    await hold(OWNER, "o-2");
    await refreshOrderErpStatuses(db, env, { fetchOrderStatuses: async () => [status("o-1"), status("o-2")] }, OWNER);
    await refreshOrderErpStatuses(db, env, { fetchOrderStatuses: async () => [status("o-1", { code: 5, label: "Faturado", invoiceNumber: 77 })] }, OWNER);
    expect(await getOrderErpStatuses(db, ["o-1", "o-2"])).toEqual([status("o-1", { code: 5, label: "Faturado", invoiceNumber: 77 })]);
  });

  it("a failed read throws and keeps what was stored (never swallowed)", async () => {
    await hold(OWNER, "o-1");
    await refreshOrderErpStatuses(db, env, { fetchOrderStatuses: async () => [status("o-1")] }, OWNER);
    await expect(
      refreshOrderErpStatuses(db, env, { fetchOrderStatuses: async () => { throw new TransportError("network", "x"); } }, OWNER),
    ).rejects.toBeInstanceOf(TransportError);
    expect(await getOrderErpStatuses(db, ["o-1"])).toEqual([status("o-1")]);
  });

  it("a source without the capability, or an account with no sent order, makes no call", async () => {
    await refreshOrderErpStatuses(db, env, {}, OWNER);
    let calls = 0;
    await refreshOrderErpStatuses(db, env, { fetchOrderStatuses: async () => (calls += 1, []) }, OWNER);
    expect(calls).toBe(0);
  });

  it("the wipe removes the stored statuses", async () => {
    await hold(OWNER, "o-1");
    await refreshOrderErpStatuses(db, env, { fetchOrderStatuses: async () => [status("o-1")] }, OWNER);
    await wipeLocalDatabase(db);
    expect(await getOrderErpStatuses(db, ["o-1"])).toEqual([]);
  });
});

describe("sync manager runs the status download after the pull", () => {
  const source = (fetchOrderStatuses: ReferenceSource["fetchOrderStatuses"]): ReferenceSource => ({
    fetchCustomers: async () => [],
    fetchProducts: async () => [],
    fetchEntryConfiguration: async () => ({ general: { enabled: true } }),
    fetchDatasetIdentity: async () => REAL,
    ...(fetchOrderStatuses === undefined ? {} : { fetchOrderStatuses }),
  });
  const transport = {} as OrderTransport;
  const run = (src: ReferenceSource) => createSyncManager({ db, env, transport, source: src, ownerAccountId: OWNER, internetState: () => "online" }).sync("manual");

  it("downloads and stores the statuses of the orders the device holds", async () => {
    await hold(OWNER, "o-1");
    const result = await run(source(async () => [status("o-1")]));
    expect(result.failure).toBeNull();
    expect(await getOrderErpStatuses(db, ["o-1"])).toEqual([status("o-1")]);
  });

  it("a failure reading the statuses is reported by the run, not hidden", async () => {
    await hold(OWNER, "o-1");
    const result = await run(source(async () => { throw new TransportError("server", "x", 503); }));
    expect(result.failure).not.toBeNull();
  });
});
