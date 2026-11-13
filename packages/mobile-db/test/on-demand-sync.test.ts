import { beforeEach, describe, expect, it } from "vitest";
import {
  createPendingCustomer,
  createSyncManager,
  CUSTOMER_BLOCK_MESSAGES,
  CUSTOMER_CREATION_NOT_RELEASED,
  getDraft,
  getMeta,
  isCustomerCreationAvailable,
  listPendingCustomers,
  migrations,
  pushPendingCustomers,
  reevaluateHeldOrders,
  replaceCustomers,
  runMigrations,
  saveOrderDraft,
  searchCustomers,
  SYNC_FAILURE_TEXT,
  TransportError,
  type CustomerLike,
  type CustomerRegistrationTransport,
  type OfflineEnv,
  type OrderCommandPayload,
  type OrderTransport,
  type ReferenceSource,
  type RefreshOutcome,
  type RefreshProgress,
  type RemoteOrder,
  type SqlDatabase,
  type SyncStatus,
  type TransportErrorKind,
} from "../src/index";
import { confirm, REAL } from "./helpers";
import { openNodeDatabase } from "./node-sqlite-connection";

const OWNER = "acct-1";

function makeEnv(): OfflineEnv & { advance(ms: number): void } {
  let t = Date.parse("2026-11-13T12:00:00.000Z");
  let n = 0;
  return {
    now: () => new Date(t),
    newId: () => `id-${String(++n).padStart(4, "0")}`,
    advance: (ms) => {
      t += ms;
    },
  };
}

class Orders implements OrderTransport {
  requests: string[] = [];
  failWith: TransportErrorKind | null = null;
  async createOrder(key: string, request: OrderCommandPayload["request"]): Promise<RemoteOrder> {
    this.requests.push(`POST ${key}`);
    if (this.failWith !== null) throw new TransportError(this.failWith, "falha", 0);
    return {
      id: `order-${this.requests.length}`,
      version: 1,
      draftNumber: this.requests.length,
      customerCode: request.customerCode,
      customerName: "Cliente",
      negotiationTypeCode: request.negotiationTypeCode,
      topCode: null,
      carrierCode: null,
      notes: request.notes,
      estimatedTotal: "0.00",
      items: request.items.map((line) => ({
        productCode: line.productCode,
        productDescription: "P",
        unit: "UN",
        quantity: line.quantity,
        unitListPrice: "10.00",
        priceState: "priced" as const,
        priceTableCode: 1,
        priceVersionId: 1,
        discountPercent: "0",
      })),
    };
  }
  async replaceOrder(): Promise<RemoteOrder> {
    throw new TransportError("validation", "x");
  }
  async getOrder(): Promise<RemoteOrder> {
    throw new TransportError("not_found", "x", 404);
  }
}

interface Script {
  calls: string[];
  customers: CustomerLike[];
  configuration: unknown;
  refresh: () => Promise<RefreshOutcome>;
  failProducts: boolean;
  /** Called inside fetchCustomers, to hold the download open in the concurrency test. */
  gate: Promise<void> | null;
}

function makeSource(script: Partial<Script> = {}): { source: ReferenceSource; state: Script } {
  const state: Script = {
    calls: [],
    customers: [{ code: 1, name: "Novo" }],
    configuration: { general: { enabled: true, clientCreationEnabled: true } },
    refresh: async () => ({ failed: false, failedSteps: [] }),
    failProducts: false,
    gate: null,
    ...script,
  };
  const source: ReferenceSource = {
    refreshOnDemand: async (onProgress: (p: RefreshProgress) => void) => {
      state.calls.push("refresh");
      onProgress({ label: "Atualizando clientes", percent: 40 });
      return state.refresh();
    },
    fetchDatasetIdentity: async () => REAL,
    fetchCustomers: async () => {
      state.calls.push("customers");
      if (state.gate !== null) await state.gate;
      return state.customers;
    },
    fetchProducts: async () => {
      state.calls.push("products");
      if (state.failProducts) throw new TransportError("network", "queda", 0);
      return [{ code: 9, description: "Produto", unit: "UN", groupCode: 1, groupName: "G", listPrice: { state: "priced", unitPrice: "10.00", tableCode: 5, versionId: 1 } } as never];
    },
    fetchEntryConfiguration: async () => {
      state.calls.push("configuration");
      return state.configuration;
    },
  };
  return { source, state };
}

let db: SqlDatabase;
let env: ReturnType<typeof makeEnv>;
let orders: Orders;
let internet: "online" | "offline" | "unknown";

beforeEach(async () => {
  db = openNodeDatabase();
  await runMigrations(db, migrations);
  await confirm(db);
  env = makeEnv();
  orders = new Orders();
  internet = "online";
});

const manager = (source: ReferenceSource, extra: { customerTransport?: CustomerRegistrationTransport } = {}) =>
  createSyncManager({ db, env, transport: orders, source, ownerAccountId: OWNER, internetState: () => internet, ...extra });

const names = async () => (await searchCustomers(db, { search: "", page: 1, pageSize: 50 })).items.map((c) => c.name);

describe("sync on demand: refresh first, then download", () => {
  it("everything ok: refresh runs BEFORE any download, the base is replaced and the success time is stored", async () => {
    const { source, state } = makeSource();
    const status = await manager(source).sync("manual");
    expect(state.calls.indexOf("refresh")).toBe(0);
    expect(state.calls).toEqual(expect.arrayContaining(["customers", "products", "configuration"]));
    expect(status).toMatchObject({ phase: "idle", failure: null, lastSyncedAt: "2026-11-13T12:00:00.000Z", lastError: null });
    expect(await names()).toEqual(["Novo"]);
    expect(await getMeta(db, "sync.last_success_at")).toBe("2026-11-13T12:00:00.000Z");
  });

  it("publishes the friendly step label while it runs", async () => {
    const { source } = makeSource();
    const seen: string[] = [];
    const m = manager(source);
    m.subscribe((s) => {
      if (s.progress !== null && s.progress !== undefined) seen.push(s.progress.label);
    });
    await m.sync("manual");
    expect(seen).toContain("Atualizando clientes");
    expect(m.getStatus().progress ?? null).toBeNull();
  });

  it("all ok with an order that needs attention: still 'synced', the order is listed with its reason", async () => {
    await db.transaction((tx) => replaceCustomers(tx, [{ code: 77, name: "C", blocked: true }]));
    await saveOrderDraft(db, env, {
      ownerAccountId: OWNER,
      customerCode: 77,
      customerName: "C",
      negotiationTypeCode: null,
      notes: null,
      loadedDataset: REAL,
      items: [{ productCode: 9, description: "P", unit: "UN", quantity: "1", discountPercent: "0", priceJson: JSON.stringify({ state: "priced", unitPrice: "10.00" }), groupCode: 1, groupName: "G" }],
    });
    // The pulled base still says the customer is blocked.
    const { source } = makeSource({ customers: [{ code: 77, name: "C", blocked: true }] });
    const status = await manager(source).sync("manual");
    expect(status.phase).toBe("idle");
    expect(status.failure).toBeNull();
    expect(status.lastSyncedAt).not.toBeNull();
    expect(status.needsAttention).toBe(1);
    expect(status.attention).toEqual([{ localId: expect.any(String), customerName: "C", reason: CUSTOMER_BLOCK_MESSAGES.customer_blocked }]);
    expect(orders.requests).toEqual([]);
  });
});

describe("price tables that failed are not a clean sync", () => {
  it("a table that could not be read: the pull is applied but the run says so and does not store a success time", async () => {
    const { source } = makeSource({ customers: [{ code: 1, name: "Novo", priceTableCode: 3 } as CustomerLike] });
    const status = await manager({ ...source, fetchPriceTables: async () => ({ tables: [], failed: [3] }) }).sync("manual");
    expect(await names()).toEqual(["Novo"]);
    expect(status.failure).toBe("error");
    expect(status.lastError).toBe("Algumas tabelas de preço não foram baixadas. Sincronize novamente.");
    expect(status.lastSyncedAt).toBeNull();
  });
});

describe("failures keep the previous base whole and say why", () => {
  const seed = async () => {
    const first = makeSource({ customers: [{ code: 1, name: "Antigo" }] });
    await manager(first.source).sync("manual");
    env.advance(3_600_000);
    return "2026-11-13T12:00:00.000Z";
  };

  it("no internet: nothing is downloaded or erased, the time does not move", async () => {
    const stamp = await seed();
    internet = "offline";
    const { source, state } = makeSource({
      customers: [{ code: 2, name: "Outro" }],
      refresh: async () => {
        throw new TransportError("network", "sem rede", 0);
      },
    });
    const status = await manager(source).sync("manual");
    expect(status).toMatchObject({ phase: "offline", failure: "no_internet", lastError: SYNC_FAILURE_TEXT.no_internet, lastSyncedAt: stamp });
    expect(state.calls).not.toContain("customers");
    expect(await names()).toEqual(["Antigo"]);
    expect(await getMeta(db, "sync.last_success_at")).toBe(stamp);
  });

  it("API down (internet fine, no answer): server_unavailable, base intact", async () => {
    const stamp = await seed();
    const { source } = makeSource({
      refresh: async () => {
        throw new TransportError("network", "sem resposta", 0);
      },
    });
    const status = await manager(source).sync("manual");
    expect(status).toMatchObject({ phase: "offline", failure: "server_unavailable", lastError: SYNC_FAILURE_TEXT.server_unavailable, lastSyncedAt: stamp });
    expect(await names()).toEqual(["Antigo"]);
  });

  it("API answering 5xx is the same: server_unavailable", async () => {
    await seed();
    const { source } = makeSource({
      refresh: async () => {
        throw new TransportError("server", "502", 502);
      },
    });
    expect(await manager(source).sync("manual")).toMatchObject({ phase: "offline", failure: "server_unavailable" });
  });

  it("the dataset check failing offline also gets the right reason (no download attempted)", async () => {
    const stamp = await seed();
    internet = "offline";
    const { source, state } = makeSource();
    source.fetchDatasetIdentity = async () => {
      throw new TransportError("network", "x", 0);
    };
    const status = await manager(source).sync("manual");
    expect(status).toMatchObject({ failure: "no_internet", lastSyncedAt: stamp });
    expect(state.calls).toEqual([]);
  });

  it("Sankhya down (failed steps): still downloads what the server has, says which, and keeps the old success time", async () => {
    const stamp = await seed();
    const { source, state } = makeSource({
      customers: [{ code: 2, name: "Do servidor" }],
      refresh: async () => ({ failed: true, failedSteps: ["Preços"] }),
    });
    const status = await manager(source).sync("manual");
    expect(state.calls).toContain("customers");
    expect(await names()).toEqual(["Do servidor"]);
    expect(status).toMatchObject({ phase: "idle", failure: "sankhya_unavailable", lastError: SYNC_FAILURE_TEXT.sankhya_unavailable, failedSteps: ["Preços"], lastSyncedAt: stamp });
    expect(await getMeta(db, "sync.last_success_at")).toBe(stamp);
  });

  it("carries the mobility counts of the refresh into the status, and drops them on the next run without", async () => {
    await seed();
    const counts = [{ kind: "products" as const, visible: 5, hidden: 1, keptPrevious: true }];
    let withCounts = true;
    const { source } = makeSource({ refresh: async () => ({ failed: false, failedSteps: [], ...(withCounts ? { mobility: counts } : {}) }) });
    const m = manager(source);
    expect((await m.sync("manual")).mobility).toEqual(counts);
    withCounts = false;
    expect((await m.sync("manual")).mobility ?? []).toEqual([]);
  });

  it("a download that dies midway (products) leaves the whole previous base untouched", async () => {
    const stamp = await seed();
    const { source } = makeSource({ customers: [{ code: 2, name: "Parcial" }], failProducts: true });
    const status = await manager(source).sync("manual");
    expect(status.lastSyncedAt).toBe(stamp);
    expect(status.failure).not.toBeNull();
    expect(await names()).toEqual(["Antigo"]);
  });

  it("expired session: auth_required, nothing downloaded", async () => {
    await seed();
    const { source, state } = makeSource({
      refresh: async () => {
        throw new TransportError("auth", "401", 401);
      },
    });
    const status = await manager(source).sync("manual");
    expect(status).toMatchObject({ phase: "auth_required", failure: "auth" });
    expect(state.calls).not.toContain("customers");
  });

  it("the success time only advances on success: ok, fail, ok", async () => {
    const m = manager(makeSource().source);
    const first = await m.sync("manual");
    env.advance(60_000);
    const bad = makeSource({
      refresh: async () => {
        throw new TransportError("network", "x", 0);
      },
    });
    const failed = await createSyncManager({ db, env, transport: orders, source: bad.source, ownerAccountId: OWNER, internetState: () => internet }).sync("manual");
    expect(failed.lastSyncedAt).toBe(first.lastSyncedAt);
    env.advance(60_000);
    const third = await m.sync("manual");
    expect(third.lastSyncedAt).toBe("2026-11-13T12:02:00.000Z");
  });
});

describe("one run in flight", () => {
  it("login + button at the same time share the SAME execution: one refresh, one download", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { source, state } = makeSource({ gate });
    const m = manager(source);
    const a = m.sync("login");
    const b = m.sync("manual");
    expect(b).toBe(a);
    release();
    await Promise.all([a, b]);
    expect(state.calls.filter((c) => c === "refresh")).toHaveLength(1);
    expect(state.calls.filter((c) => c === "customers")).toHaveLength(1);
  });

  it("a button press during a push-only run is not swallowed: the download still happens after it", async () => {
    const { source, state } = makeSource();
    const m = manager(source);
    const pushOnly = m.sync("after_save", { pull: false });
    const manual = m.sync("manual");
    await Promise.all([pushOnly, manual]);
    expect(state.calls.filter((c) => c === "refresh")).toHaveLength(1);
    expect(state.calls).toContain("customers");
  });

  it("a push-only run never refreshes or downloads reference data", async () => {
    const { source, state } = makeSource();
    const status = await manager(source).sync("timer", { pull: false });
    expect(state.calls).toEqual([]);
    expect(status.lastSyncedAt).toBeNull();
  });
});

describe("marked drafts are re-evaluated after each sync", () => {
  const draft = (customerCode: number) =>
    saveOrderDraft(db, env, {
      ownerAccountId: OWNER,
      customerCode,
      customerName: "C",
      negotiationTypeCode: null,
      notes: null,
      loadedDataset: REAL,
      items: [{ productCode: 9, description: "P", unit: "UN", quantity: "1", discountPercent: "0", priceJson: JSON.stringify({ state: "priced", unitPrice: "10.00" }), groupCode: 1, groupName: "G" }],
    });

  it("the reason goes away (and the order is sent) when the new base resolves it", async () => {
    await db.transaction((tx) => replaceCustomers(tx, [{ code: 77, name: "C", blocked: true }]));
    const id = await draft(77);
    await manager(makeSource({ customers: [{ code: 77, name: "C", blocked: true }] }).source).sync("manual");
    expect(await getDraft(db, id)).toMatchObject({ status: "sync_error", lastError: CUSTOMER_BLOCK_MESSAGES.customer_blocked });
    await manager(makeSource({ customers: [{ code: 77, name: "C", blocked: false, active: true }] }).source).sync("manual");
    const after = await getDraft(db, id);
    expect(after?.lastError ?? null).toBeNull();
    expect(after?.status).toBe("synced");
  });

  it("the reason stays when the customer is still blocked after the sync", async () => {
    await db.transaction((tx) => replaceCustomers(tx, [{ code: 77, name: "C", blocked: true }]));
    const id = await draft(77);
    await manager(makeSource({ customers: [{ code: 77, name: "C", blocked: true }] }).source).sync("manual");
    await manager(makeSource({ customers: [{ code: 77, name: "C", blocked: true }] }).source).sync("manual");
    expect(await getDraft(db, id)).toMatchObject({ status: "sync_error", lastError: CUSTOMER_BLOCK_MESSAGES.customer_blocked });
  });

  it("reevaluateHeldOrders alone clears a resolved mark without sending anything", async () => {
    await db.transaction((tx) => replaceCustomers(tx, [{ code: 77, name: "C", blocked: true }]));
    const id = await draft(77);
    await manager(makeSource({ customers: [{ code: 77, name: "C", blocked: true }] }).source).sync("manual");
    await db.transaction((tx) => replaceCustomers(tx, [{ code: 77, name: "C", active: true }]));
    expect(await reevaluateHeldOrders(db, env, OWNER)).toBe(1);
    expect(await getDraft(db, id)).toMatchObject({ status: "pending_sync", lastError: null });
    expect(orders.requests).toEqual([]);
  });
});

describe("customer creation signal comes from the configuration, at every sync", () => {
  const erpOff: CustomerRegistrationTransport = {
    createCustomer: async () => {
      throw new TransportError("server", "off", 409, "customer_write_disabled");
    },
    getCustomer: async () => {
      throw new TransportError("not_found", "x", 404);
    },
  } as never;

  it("clientCreationEnabled === false hides it; true shows it again; absent does not hide (and does not infer)", async () => {
    await manager(makeSource({ configuration: { general: { enabled: true, clientCreationEnabled: false } } }).source).sync("manual");
    expect(await isCustomerCreationAvailable(db, env)).toBe(false);
    await manager(makeSource({ configuration: { general: { enabled: true, clientCreationEnabled: true } } }).source).sync("manual");
    expect(await isCustomerCreationAvailable(db, env)).toBe(true);
    await manager(makeSource({ configuration: { general: { enabled: true, clientCreationEnabled: false } } }).source).sync("manual");
    await manager(makeSource({ configuration: { general: { enabled: true } } }).source).sync("manual");
    expect(await isCustomerCreationAvailable(db, env)).toBe(true);
  });

  it("there is no one-hour expiry any more: 'off' stays off until a sync says otherwise", async () => {
    await manager(makeSource({ configuration: { general: { enabled: true, clientCreationEnabled: false } } }).source).sync("manual");
    env.advance(5 * 3_600_000);
    expect(await isCustomerCreationAvailable(db, env)).toBe(false);
  });

  it("a 409 customer_write_disabled still hides it until the next sync; the sync that says 'on' clears the notice and re-queues", async () => {
    const record = await createPendingCustomer(db, env, { ownerAccountId: OWNER, request: { document: "123.456.789-09", name: "Padaria", tradeName: null, icmsClassification: "R", stateRegistration: null, phone: null, email: null, notes: null, addresses: [{ streetCode: 1, neighborhoodCode: 2, number: "10", complement: null, postalCode: "01001000" }] } });
    await pushPendingCustomers(db, env, erpOff, OWNER, { currentDataset: REAL, respectBackoff: false });
    expect(await isCustomerCreationAvailable(db, env)).toBe(false);
    expect((await listPendingCustomers(db, OWNER, REAL))[0]?.lastError).toBe(CUSTOMER_CREATION_NOT_RELEASED);
    await manager(makeSource({ configuration: { general: { enabled: true, clientCreationEnabled: true } } }).source).sync("manual");
    expect(await isCustomerCreationAvailable(db, env)).toBe(true);
    const row = (await listPendingCustomers(db, OWNER, REAL)).find((r) => r.clientRequestId === record.clientRequestId);
    expect(row?.lastError ?? null).toBeNull();
  });
});

describe("types", () => {
  it("SyncStatus carries the new optional fields", () => {
    const status: SyncStatus = { phase: "idle", pending: 0, needsAttention: 0, lastSyncedAt: null, lastError: null, failure: null, failedSteps: [], attention: [], progress: null };
    expect(status.failure).toBeNull();
  });
});
