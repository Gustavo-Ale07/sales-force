import { beforeEach, describe, expect, it } from "vitest";
import {
  createSyncManager,
  migrations,
  pullReferenceData,
  refreshOrderErpStatuses,
  replaceCustomers,
  runMigrations,
  saveOrderDraft,
  searchCustomers,
  TransportError,
  type CustomerLike,
  type OfflineEnv,
  type OrderCommandPayload,
  type OrderErpStatus,
  type OrderTransport,
  type ReferenceSource,
  type RemoteOrder,
  type SqlDatabase,
  type SyncStatus,
  type SyncStep,
  type SyncStepEvent,
  type SyncStepId,
} from "../src/index";
import { confirm, REAL } from "./helpers";
import { openNodeDatabase } from "./node-sqlite-connection";

const OWNER = "acct-1";
const ORDER: readonly SyncStepId[] = ["push", "server", "customers", "products", "prices", "negotiation", "carriers", "save", "orders"];

let n = 0;
const env: OfflineEnv = { now: () => new Date("2026-11-23T12:00:00.000Z"), newId: () => `id-${String(++n).padStart(6, "0")}` };

/** Transport that is never reached when there is nothing to send; fails like a dead network when asked to send. */
const deadTransport: OrderTransport = {
  async createOrder(_key: string, _request: OrderCommandPayload["request"]): Promise<RemoteOrder> {
    throw new TransportError("network", "sem rede", 0);
  },
  async replaceOrder(): Promise<RemoteOrder> {
    throw new TransportError("network", "sem rede", 0);
  },
  async getOrder(): Promise<RemoteOrder> {
    throw new TransportError("network", "sem rede", 0);
  },
};

interface Knobs {
  customers: CustomerLike[];
  products: unknown[];
  configuration: unknown;
  carriers: unknown[] | "fail" | "absent";
  failProducts: boolean;
  refresh: "absent" | "ok" | "failed" | "throws";
  statuses: "absent" | "ok";
}

function makeSource(over: Partial<Knobs> = {}): ReferenceSource {
  const k: Knobs = {
    customers: [
      { code: 1, name: "A", priceTableCode: 3 } as CustomerLike,
      { code: 2, name: "B", priceTableCode: 3 } as CustomerLike,
      { code: 3, name: "C", priceTableCode: 4 } as CustomerLike,
    ],
    products: [
      { code: 10, description: "P1", unit: "UN", groupCode: 1, groupName: "G" },
      { code: 11, description: "P2", unit: "UN", groupCode: 1, groupName: "G" },
    ],
    configuration: { negotiationTypes: [{ code: 1 }, { code: 2 }, { code: 3 }, { code: 4 }] },
    carriers: [{ code: 1 }, { code: 2 }],
    failProducts: false,
    refresh: "ok",
    statuses: "absent",
    ...over,
  };
  const source: ReferenceSource = {
    fetchDatasetIdentity: async () => REAL,
    fetchCustomers: async (onPage) => {
      onPage?.(k.customers.length, k.customers.length);
      return k.customers;
    },
    fetchProducts: async (onPage) => {
      if (k.failProducts) throw new TransportError("network", "queda", 0);
      onPage?.(k.products.length, k.products.length);
      return k.products as never;
    },
    fetchEntryConfiguration: async () => k.configuration,
    fetchPriceTables: async (codes, onTable) => {
      const tables = codes.map((code) => ({ code, prices: [{ productCode: 10, unitPrice: "1.00" }, { productCode: 11, unitPrice: "2.00" }] }));
      codes.forEach((_c, i) => onTable?.(i + 1, codes.length, (i + 1) * 2));
      return { tables: tables as never, failed: [] };
    },
  };
  if (k.carriers !== "absent") {
    source.fetchCarriers = async () => {
      if (k.carriers === "fail") throw new TransportError("server", "x", 500);
      return k.carriers as never;
    };
  }
  if (k.refresh !== "absent") {
    source.refreshOnDemand = async () => {
      if (k.refresh === "throws") throw new TransportError("network", "sem rede", 0);
      return k.refresh === "failed" ? { failed: true, failedSteps: ["clientes"] } : { failed: false, failedSteps: [] };
    };
  }
  if (k.statuses === "ok") source.fetchOrderStatuses = async () => [];
  return source;
}

let db: SqlDatabase;
beforeEach(async () => {
  db = openNodeDatabase();
  await runMigrations(db, migrations);
  await confirm(db);
});

const manager = (source: ReferenceSource, transport: OrderTransport = deadTransport) =>
  createSyncManager({ db, env, transport, source, ownerAccountId: OWNER, internetState: () => "online" });
const stepOf = (status: SyncStatus, id: SyncStepId): SyncStep => {
  const found = status.steps?.find((s) => s.id === id);
  if (found === undefined) throw new Error(`step ${id} missing`);
  return found;
};

describe("sync steps on a successful full run", () => {
  it("lists the nine steps in the documented order, all done", async () => {
    const status = await manager(makeSource()).sync("manual");
    expect(status.phase).toBe("idle");
    expect(status.steps?.map((s) => s.id)).toEqual([...ORDER]);
    expect(status.steps?.map((s) => s.state)).toEqual(ORDER.map(() => "done"));
  });

  it("counts per step come from the pipeline (customers, products, prices, negotiation types, carriers)", async () => {
    const status = await manager(makeSource()).sync("manual");
    expect(stepOf(status, "customers")).toMatchObject({ count: 3, total: 3 });
    expect(stepOf(status, "products")).toMatchObject({ count: 2, total: 2 });
    // two distinct tables (3 and 4) x 2 prices
    expect(stepOf(status, "prices")).toMatchObject({ count: 4, total: 4, note: "2 tabelas" });
    expect(stepOf(status, "negotiation")).toMatchObject({ count: 4 });
    expect(stepOf(status, "carriers")).toMatchObject({ count: 2 });
    expect(stepOf(status, "save")).toMatchObject({ count: 5 });
  });

  it("states pass through running before done, in pipeline order, via the subscriber", async () => {
    const m = manager(makeSource());
    const firstRunning: SyncStepId[] = [];
    m.subscribe((s) => {
      for (const step of s.steps ?? []) if (step.state === "running" && !firstRunning.includes(step.id)) firstRunning.push(step.id);
    });
    await m.sync("manual");
    expect(firstRunning).toEqual(expect.arrayContaining(["server", "customers", "products", "prices", "carriers", "save", "orders"]));
    expect(firstRunning.indexOf("server")).toBeLessThan(firstRunning.indexOf("customers"));
    expect(firstRunning.indexOf("prices")).toBeLessThan(firstRunning.indexOf("carriers"));
    expect(firstRunning.indexOf("carriers")).toBeLessThan(firstRunning.indexOf("save"));
    expect(firstRunning.indexOf("save")).toBeLessThan(firstRunning.indexOf("orders"));
  });

  it("customers without a price table: the prices step is done with zero rows", async () => {
    const status = await manager(makeSource({ customers: [{ code: 1, name: "A" }] })).sync("manual");
    expect(stepOf(status, "prices")).toMatchObject({ state: "done", count: 0 });
  });

  it("a source without refreshOnDemand marks the server step done", async () => {
    const status = await manager(makeSource({ refresh: "absent" })).sync("manual");
    expect(stepOf(status, "server").state).toBe("done");
  });

  it("the server step is indeterminate only while running", async () => {
    const m = manager(makeSource());
    const flags: boolean[] = [];
    m.subscribe((s) => {
      const server = s.steps?.find((x) => x.id === "server");
      if (server?.state === "running") flags.push(server.indeterminate);
    });
    const final = await m.sync("manual");
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.every(Boolean)).toBe(true);
    expect(stepOf(final, "server").indeterminate).toBe(false);
  });
});

describe("carriers", () => {
  it("a failed carriers read: step error with the note, but the run still succeeds", async () => {
    const status = await manager(makeSource({ carriers: "fail" })).sync("manual");
    expect(status.phase).toBe("idle");
    expect(status.failure).toBeNull();
    expect(stepOf(status, "carriers")).toMatchObject({ state: "error", note: "mantidas as anteriores" });
    expect(stepOf(status, "save").state).toBe("done");
    expect(stepOf(status, "orders").state).toBe("done");
  });

  it("a source without carriers: step done with zero", async () => {
    const status = await manager(makeSource({ carriers: "absent" })).sync("manual");
    expect(stepOf(status, "carriers")).toMatchObject({ state: "done", count: 0 });
  });
});

describe("failures", () => {
  it("failure during push: push step error, every later step pending, nothing downloaded", async () => {
    const transport: OrderTransport = deadTransport;
    await saveOrderDraft(db, env, {
      ownerAccountId: OWNER,
      customerCode: 1,
      customerName: "A",
      negotiationTypeCode: null,
      notes: null,
      loadedDataset: REAL,
      items: [{ productCode: 10, description: "P1", unit: "UN", quantity: "1", discountPercent: "0", priceJson: JSON.stringify({ state: "priced", unitPrice: "1.00" }), groupCode: 1, groupName: "G" }],
    });
    const status = await manager(makeSource(), transport).sync("manual");
    expect(status.phase).not.toBe("idle");
    expect(stepOf(status, "push").state).toBe("error");
    for (const id of ORDER.slice(1)) expect(stepOf(status, id).state).toBe("pending");
    expect((await searchCustomers(db, { search: "", page: 1, pageSize: 10 })).total).toBe(0);
  });

  it("failure during the download: the running step is error, earlier ones keep their state and the previous base is kept", async () => {
    await db.transaction((tx) => replaceCustomers(tx, [{ code: 99, name: "Antigo" }]));
    const status = await manager(makeSource({ failProducts: true })).sync("manual");
    expect(status.phase).not.toBe("idle");
    expect(stepOf(status, "server").state).toBe("done");
    expect(stepOf(status, "products").state).toBe("error");
    expect(stepOf(status, "save").state).toBe("pending");
    expect(stepOf(status, "orders").state).toBe("pending");
    expect((await searchCustomers(db, { search: "", page: 1, pageSize: 10 })).items.map((c) => c.name)).toEqual(["Antigo"]);
  });

  it("refreshOnDemand reporting failure: server step error with sankhya_unavailable, the download still happens", async () => {
    const status = await manager(makeSource({ refresh: "failed" })).sync("manual");
    expect(status.failure).toBe("sankhya_unavailable");
    expect(stepOf(status, "server")).toMatchObject({ state: "error", note: "mantida a última base" });
    expect(stepOf(status, "customers").state).toBe("done");
    expect(stepOf(status, "save").state).toBe("done");
    expect(status.lastSyncedAt).toBeNull();
  });

  it("refreshOnDemand throwing a transport error: the server step is error and nothing after it ran", async () => {
    const status = await manager(makeSource({ refresh: "throws" })).sync("manual");
    expect(status.phase).not.toBe("idle");
    expect(stepOf(status, "server").state).toBe("error");
    expect(stepOf(status, "customers").state).toBe("pending");
  });
});

describe("pullReferenceData onStep events", () => {
  it("emits running then done for customers and products with the real counts, then negotiation, prices, carriers, save", async () => {
    const events: SyncStepEvent[] = [];
    await pullReferenceData(db, env, makeSource(), OWNER, (e) => events.push(e));
    const of = (id: SyncStepId) => events.filter((e) => e.id === id);
    expect(of("customers").map((e) => e.state)).toEqual(["running", "running", "done"]);
    expect(of("customers").at(-1)).toMatchObject({ count: 3, total: 3 });
    expect(of("products").at(-1)).toMatchObject({ state: "done", count: 2, total: 2 });
    expect(of("negotiation")).toEqual([{ id: "negotiation", state: "done", count: 4 }]);
    expect(of("prices").map((e) => e.state)).toEqual(["running", "running", "running", "done"]);
    expect(of("prices")[2]).toMatchObject({ count: 4, note: "2 de 2 tabelas" });
    expect(of("carriers").map((e) => e.state)).toEqual(["running", "done"]);
    expect(of("save").map((e) => e.state)).toEqual(["running", "done"]);
    expect(events.at(-1)).toMatchObject({ id: "save", state: "done", count: 5 });
  });

  it("without a negotiationTypes list the negotiation step reports zero", async () => {
    const events: SyncStepEvent[] = [];
    await pullReferenceData(db, env, makeSource({ configuration: null }), OWNER, (e) => events.push(e));
    expect(events.find((e) => e.id === "negotiation")).toMatchObject({ state: "done", count: 0 });
  });

  it("carriers failure emits an error event and the pull still resolves", async () => {
    const events: SyncStepEvent[] = [];
    await expect(pullReferenceData(db, env, makeSource({ carriers: "fail" }), OWNER, (e) => events.push(e))).resolves.toBeDefined();
    expect(events.filter((e) => e.id === "carriers").at(-1)).toMatchObject({ state: "error", note: "mantidas as anteriores" });
  });

  it("is optional: no callback does not change the result", async () => {
    await expect(pullReferenceData(db, env, makeSource(), OWNER)).resolves.toMatchObject({ customers: 3, products: 2 });
  });
});

describe("refreshOrderErpStatuses onProgress", () => {
  const hold = async (id: string) => {
    const local = await saveOrderDraft(db, env, {
      ownerAccountId: OWNER,
      customerCode: 10,
      customerName: "C",
      negotiationTypeCode: null,
      notes: null,
      loadedDataset: REAL,
      items: [{ productCode: 1, description: "P", unit: "UN", quantity: "1", discountPercent: "0", priceJson: JSON.stringify({ state: "priced", unitPrice: "1.00" }), groupCode: 1, groupName: "G" }],
    });
    await db.execute("DELETE FROM outbox WHERE draft_local_id = ?", [local]);
    await db.execute("UPDATE local_order_draft SET remote_id = ?, status = 'synced' WHERE local_id = ?", [id, local]);
  };

  it("reports (done, total) after each chunk of 100", async () => {
    for (let i = 0; i < 230; i += 1) await hold(`o-${String(i).padStart(3, "0")}`);
    const calls: [number, number][] = [];
    await refreshOrderErpStatuses(db, env, { fetchOrderStatuses: async () => [] as readonly OrderErpStatus[] }, OWNER, (done, total) => calls.push([done, total]));
    expect(calls).toEqual([
      [100, 230],
      [200, 230],
      [230, 230],
    ]);
  });

  it("no report when there is nothing to ask or no capability; a failed chunk is not reported as done", async () => {
    const calls: [number, number][] = [];
    await refreshOrderErpStatuses(db, env, {}, OWNER, (d, t) => calls.push([d, t]));
    await refreshOrderErpStatuses(db, env, { fetchOrderStatuses: async () => [] }, OWNER, (d, t) => calls.push([d, t]));
    expect(calls).toEqual([]);
    for (let i = 0; i < 150; i += 1) await hold(`o-${String(i).padStart(3, "0")}`);
    let call = 0;
    await expect(
      refreshOrderErpStatuses(
        db,
        env,
        { fetchOrderStatuses: async () => { call += 1; if (call === 2) throw new TransportError("network", "x"); return []; } },
        OWNER,
        (d, t) => calls.push([d, t]),
      ),
    ).rejects.toBeInstanceOf(TransportError);
    expect(calls).toEqual([[100, 150]]);
  });

  it("the sync manager publishes the orders step with the chunk counts", async () => {
    for (let i = 0; i < 130; i += 1) await hold(`o-${String(i).padStart(3, "0")}`);
    const m = manager(makeSource({ statuses: "ok" }));
    const counts: (number | null)[] = [];
    m.subscribe((s) => {
      const step = s.steps?.find((x) => x.id === "orders");
      if (step?.state === "running") counts.push(step.count);
    });
    const final = await m.sync("manual");
    expect(counts).toEqual(expect.arrayContaining([0, 100, 130]));
    expect(stepOf(final, "orders").state).toBe("done");
  });
});
