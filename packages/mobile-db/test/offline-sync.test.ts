import { beforeEach, describe, expect, it } from "vitest";
import {
  acknowledgePriceReview,
  backoffDelayMs,
  countOutbox,
  createSyncManager,
  discardLocalDraft,
  getDraft,
  getDraftItems,
  listDrafts,
  listOutbox,
  migrations,
  pullReferenceData,
  pushOutbox,
  recoverInterrupted,
  resolveConflict,
  runMigrations,
  saveOrderDraft,
  searchProducts,
  TransportError,
  type DraftItemInput,
  type OfflineEnv,
  type OrderCommandPayload,
  type OrderTransport,
  type ReferenceSource,
  type RemoteOrder,
  type SaveDraftInput,
  type SqlDatabase,
  type TransportErrorKind,
} from "../src/index";
import { openNodeDatabase } from "./node-sqlite-connection";

const OWNER = "acct-1";

function makeEnv(): OfflineEnv & { advance(ms: number): void } {
  let t = Date.parse("2026-09-30T12:00:00.000Z");
  let n = 0;
  return {
    now: () => new Date(t),
    newId: () => `id-${String(++n).padStart(4, "0")}`,
    advance: (ms) => {
      t += ms;
    },
  };
}

const price = (unit: string | null) => JSON.stringify(unit === null ? { state: "none", unitPrice: null } : { state: "priced", unitPrice: unit });
function item(productCode: number, quantity = "2", unitPrice: string | null = "10.00", discountPercent = "0"): DraftItemInput {
  return { productCode, description: `Produto ${productCode}`, unit: "UN", quantity, discountPercent, priceJson: price(unitPrice), groupCode: 1, groupName: "Grupo" };
}
function input(items: DraftItemInput[], extra: Partial<SaveDraftInput> = {}): SaveDraftInput {
  return { ownerAccountId: OWNER, customerCode: 77, customerName: "Cliente", negotiationTypeCode: null, notes: null, items, ...extra };
}

/** In-memory stand-in for the API's idempotent create and version-checked replace. */
class FakeServer implements OrderTransport {
  orders = new Map<string, RemoteOrder>();
  byKey = new Map<string, { body: string; id: string }>();
  requests: string[] = [];
  serverPrices = new Map<number, string | null>();
  /** Apply the request on the server, then fail as if the response was lost. */
  loseResponseOnce = false;
  /** Fail before the server sees anything. */
  failWith: TransportErrorKind | null = null;
  private seq = 0;

  private build(id: string, version: number, draftNumber: number, request: OrderCommandPayload["request"]): RemoteOrder {
    const items = request.items.map((line) => {
      const unit = this.serverPrices.has(line.productCode) ? (this.serverPrices.get(line.productCode) ?? null) : "10.00";
      return {
        productCode: line.productCode,
        productDescription: `Produto ${line.productCode}`,
        unit: "UN",
        quantity: line.quantity,
        unitListPrice: unit,
        priceState: unit === null ? ("none" as const) : ("priced" as const),
        discountPercent: line.discountPercent ?? "0",
      };
    });
    return {
      id,
      version,
      draftNumber,
      customerCode: request.customerCode,
      customerName: "Cliente",
      negotiationTypeCode: request.negotiationTypeCode,
      notes: request.notes,
      estimatedTotal: "0.00",
      items,
    };
  }

  private gate(): void {
    if (this.failWith !== null) throw new TransportError(this.failWith, "falha", this.failWith === "network" ? 0 : 500);
  }

  async createOrder(key: string, request: OrderCommandPayload["request"]): Promise<RemoteOrder> {
    this.requests.push(`POST ${key}`);
    this.gate();
    const body = JSON.stringify(request);
    const known = this.byKey.get(key);
    let order: RemoteOrder;
    if (known !== undefined) {
      if (known.body !== body) throw new TransportError("idempotency_conflict", "mesma chave, outro corpo", 409);
      order = this.orders.get(known.id) as RemoteOrder;
    } else {
      const id = `order-${++this.seq}`;
      order = this.build(id, 1, this.seq, request);
      this.orders.set(id, order);
      this.byKey.set(key, { body, id });
    }
    if (this.loseResponseOnce) {
      this.loseResponseOnce = false;
      throw new TransportError("network", "conexão perdida");
    }
    return order;
  }

  async replaceOrder(id: string, expectedVersion: number, request: OrderCommandPayload["request"]): Promise<RemoteOrder> {
    this.requests.push(`PUT ${id} v${expectedVersion}`);
    this.gate();
    const current = this.orders.get(id);
    if (current === undefined) throw new TransportError("not_found", "x", 404);
    if (current.version !== expectedVersion) throw new TransportError("version_conflict", "versão", 409);
    const next = this.build(id, current.version + 1, current.draftNumber, request);
    this.orders.set(id, next);
    return next;
  }

  async getOrder(id: string): Promise<RemoteOrder> {
    const order = this.orders.get(id);
    if (order === undefined) throw new TransportError("not_found", "x", 404);
    return order;
  }

  /** Someone else edits the server draft. */
  foreignEdit(id: string): void {
    const current = this.orders.get(id) as RemoteOrder;
    this.orders.set(id, { ...current, version: current.version + 1, notes: "alterado por outra pessoa" });
  }
}

let db: SqlDatabase;
let env: ReturnType<typeof makeEnv>;
let server: FakeServer;

beforeEach(async () => {
  db = openNodeDatabase();
  await runMigrations(db, migrations);
  env = makeEnv();
  server = new FakeServer();
});

const push = (options = {}) => pushOutbox(db, env, server, OWNER, { respectBackoff: false, ...options });

describe("saveOrderDraft", () => {
  it("writes draft, items and one create command atomically", async () => {
    const id = await saveOrderDraft(db, env, input([item(1), item(2, "3", "5.00", "10")]));
    const draft = await getDraft(db, id);
    expect(draft).toMatchObject({ status: "pending_sync", itemCount: 2, remoteId: null });
    const ops = await listOutbox(db, id);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: "order.create", state: "pending", attempts: 0, idempotencyKey: draft?.clientRequestId });
    expect(ops[0]?.payload.request.items[1]).toEqual({ productCode: 2, quantity: "3", discountPercent: "10" });
    expect(ops[0]?.payload.request.items[0]).toEqual({ productCode: 1, quantity: "2" });
  });

  it("sends no client price: prices only ride along as a local snapshot for review", async () => {
    const id = await saveOrderDraft(db, env, input([item(1)]));
    const [op] = await listOutbox(db, id);
    expect(JSON.stringify(op?.payload.request)).not.toMatch(/price|preco/i);
    expect(op?.payload.prices).toEqual([{ productCode: 1, description: "Produto 1", unitPrice: "10.00" }]);
  });

  it("coalesces edits into the unsent create (same key, still one command)", async () => {
    const id = await saveOrderDraft(db, env, input([item(1)]));
    const key = (await getDraft(db, id))?.clientRequestId;
    await saveOrderDraft(db, env, input([item(1, "5"), item(2)], { localId: id }));
    const ops = await listOutbox(db, id);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.idempotencyKey).toBe(key);
    expect(ops[0]?.payload.request.items).toHaveLength(2);
    expect(await getDraftItems(db, id)).toHaveLength(2);
  });

  it("freezes an attempted create and queues the edit as a replace behind it", async () => {
    const id = await saveOrderDraft(db, env, input([item(1)]));
    server.failWith = "network";
    await push();
    server.failWith = null;
    await saveOrderDraft(db, env, input([item(1, "9")], { localId: id }));
    const ops = await listOutbox(db, id);
    expect(ops.map((op) => op.type)).toEqual(["order.create", "order.replace"]);
    expect(ops[0]?.payload.request.items[0]?.quantity).toBe("2"); // frozen
    expect(ops[1]?.payload.request.items[0]?.quantity).toBe("9");
  });

  it("refuses to edit another account's draft", async () => {
    const id = await saveOrderDraft(db, env, input([item(1)]));
    await expect(saveOrderDraft(db, env, input([item(1)], { localId: id, ownerAccountId: "other" }))).rejects.toThrow();
    expect(await listDrafts(db, "other")).toEqual([]);
  });
});

describe("idempotency (P-08, SNK-4)", () => {
  it("POST applied, response lost, retry with the same key ⇒ exactly one order", async () => {
    const id = await saveOrderDraft(db, env, input([item(1)]));
    server.loseResponseOnce = true;
    const first = await push();
    expect(first.stoppedBy).toBe("offline");
    expect(server.orders.size).toBe(1); // the server applied it
    let [op] = await listOutbox(db, id);
    expect(op).toMatchObject({ state: "pending", attempts: 1 });
    expect((await getDraft(db, id))?.status).toBe("sync_error");

    const second = await push();
    expect(second).toMatchObject({ accepted: 1, stoppedBy: "idle" });
    expect(server.orders.size).toBe(1);
    expect(server.byKey.size).toBe(1);
    const keys = server.requests.filter((r) => r.startsWith("POST"));
    expect(new Set(keys).size).toBe(1); // both POSTs carried the same key
    expect(keys).toHaveLength(2);
    expect(await listOutbox(db, id)).toEqual([]);
    expect(await getDraft(db, id)).toMatchObject({ status: "synced", remoteId: "order-1", remoteVersion: 1 });
    [op] = await listOutbox(db);
    expect(op).toBeUndefined();
  });

  it("an app kill mid-request (state sending) is recovered and retried with the same key", async () => {
    const id = await saveOrderDraft(db, env, input([item(1)]));
    const key = (await getDraft(db, id))?.clientRequestId;
    await db.execute("UPDATE outbox SET state = 'sending', attempts = 1");
    expect(await recoverInterrupted(db, env)).toBe(1);
    const [op] = await listOutbox(db, id);
    expect(op).toMatchObject({ state: "pending", attempts: 1, idempotencyKey: key });
    await push();
    expect(server.orders.size).toBe(1);
  });

  it("a second push of an emptied queue sends nothing", async () => {
    await saveOrderDraft(db, env, input([item(1)]));
    await push();
    const before = server.requests.length;
    await push();
    expect(server.requests).toHaveLength(before);
  });
});

describe("error classification and retries", () => {
  it("transient server error backs off exponentially and keeps the command", async () => {
    const id = await saveOrderDraft(db, env, input([item(1)]));
    server.failWith = "server";
    await pushOutbox(db, env, server, OWNER, { respectBackoff: true });
    let [op] = await listOutbox(db, id);
    expect(op).toMatchObject({ state: "pending", attempts: 1 });
    expect(op?.nextAttemptAt).toBe(new Date(env.now().getTime() + 5_000).toISOString());

    // Inside the backoff window an automatic run sends nothing.
    const before = server.requests.length;
    await pushOutbox(db, env, server, OWNER, { respectBackoff: true });
    expect(server.requests).toHaveLength(before);

    env.advance(5_001);
    await pushOutbox(db, env, server, OWNER, { respectBackoff: true });
    [op] = await listOutbox(db, id);
    expect(op?.attempts).toBe(2);
    expect(op?.nextAttemptAt).toBe(new Date(env.now().getTime() + 10_000).toISOString());
  });

  it("backoff doubles and caps at 15 minutes", () => {
    expect([1, 2, 3, 4].map(backoffDelayMs)).toEqual([5_000, 10_000, 20_000, 40_000]);
    expect(backoffDelayMs(30)).toBe(15 * 60_000);
  });

  it("a manual sync ignores the backoff window", async () => {
    await saveOrderDraft(db, env, input([item(1)]));
    server.failWith = "server";
    await push();
    server.failWith = null;
    const result = await push({ respectBackoff: false });
    expect(result.accepted).toBe(1);
  });

  it("validation errors are permanent: rejected once, never retried blindly", async () => {
    const id = await saveOrderDraft(db, env, input([item(1)]));
    server.failWith = "validation";
    await push();
    server.failWith = null;
    const before = server.requests.length;
    await push();
    expect(server.requests).toHaveLength(before);
    const [op] = await listOutbox(db, id);
    expect(op).toMatchObject({ state: "rejected", attempts: 1 });
    expect(await getDraft(db, id)).toMatchObject({ status: "sync_error" });
  });

  it("after a definite rejection an edit creates a new create with a NEW key", async () => {
    const id = await saveOrderDraft(db, env, input([item(1)]));
    const firstKey = (await getDraft(db, id))?.clientRequestId;
    server.failWith = "validation";
    await push();
    server.failWith = null;
    await saveOrderDraft(db, env, input([item(1, "1")], { localId: id }));
    const draft = await getDraft(db, id);
    expect(draft?.clientRequestId).not.toBe(firstKey);
    await push();
    expect(server.orders.size).toBe(1);
    expect((await getDraft(db, id))?.status).toBe("synced");
  });

  it("auth failure stops the run without penalizing the command", async () => {
    const id = await saveOrderDraft(db, env, input([item(1)]));
    server.failWith = "auth";
    const result = await push();
    expect(result.stoppedBy).toBe("auth");
    const [op] = await listOutbox(db, id);
    expect(op).toMatchObject({ state: "pending", nextAttemptAt: null });
  });

  it("a dead network costs one attempt, not one per queued draft", async () => {
    await saveOrderDraft(db, env, input([item(1)]));
    await saveOrderDraft(db, env, input([item(2)]));
    await saveOrderDraft(db, env, input([item(3)]));
    server.failWith = "network";
    const result = await push();
    expect(result).toMatchObject({ attempted: 1, stoppedBy: "offline" });
  });

  it("error text shown to the seller is never technical", async () => {
    const id = await saveOrderDraft(db, env, input([item(1)]));
    server.failWith = "network";
    await push();
    const draft = await getDraft(db, id);
    expect(draft?.lastError).not.toMatch(/network request failed|fetch|TypeError/i);
    expect(draft?.lastError).toMatch(/conexão/i);
  });
});

describe("ordering and chaining", () => {
  it("create then replace of the same draft are sent in order with the returned version", async () => {
    const id = await saveOrderDraft(db, env, input([item(1)]));
    server.failWith = "server";
    await push();
    server.failWith = null;
    await saveOrderDraft(db, env, input([item(1, "7")], { localId: id }));
    await push();
    expect(server.requests.filter((r) => r.startsWith("PUT"))).toEqual(["PUT order-1 v1"]);
    expect(server.orders.get("order-1")?.items[0]?.quantity).toBe("7");
    expect(await getDraft(db, id)).toMatchObject({ status: "synced", remoteVersion: 2 });
  });

  it("a rejected create rejects the commands queued behind it", async () => {
    const id = await saveOrderDraft(db, env, input([item(1)]));
    server.failWith = "server";
    await push();
    await saveOrderDraft(db, env, input([item(1, "3")], { localId: id }));
    server.failWith = "validation";
    await push();
    const ops = await listOutbox(db, id);
    expect(ops.map((op) => op.state)).toEqual(["rejected", "rejected"]);
  });

  it("one draft's failure does not block another draft", async () => {
    const a = await saveOrderDraft(db, env, input([item(1)]));
    const b = await saveOrderDraft(db, env, input([item(2)]));
    await db.execute("UPDATE outbox SET next_attempt_at = ? WHERE draft_local_id = ?", ["2999-01-01T00:00:00.000Z", a]);
    const result = await pushOutbox(db, env, server, OWNER, { respectBackoff: true });
    expect(result.accepted).toBe(1);
    expect((await getDraft(db, b))?.status).toBe("synced");
    expect((await getDraft(db, a))?.status).toBe("pending_sync");
  });
});

describe("conflicts (expectedVersion)", () => {
  async function syncedDraftWithLocalEdit(): Promise<string> {
    const id = await saveOrderDraft(db, env, input([item(1)]));
    await push();
    await saveOrderDraft(db, env, input([item(1, "8")], { localId: id }));
    return id;
  }

  it("marks CONFLICT, never overwrites the server, and keeps both sides", async () => {
    const id = await syncedDraftWithLocalEdit();
    server.foreignEdit("order-1");
    await push();
    const draft = await getDraft(db, id);
    expect(draft?.status).toBe("conflict");
    expect((draft?.serverSnapshot as RemoteOrder).notes).toBe("alterado por outra pessoa");
    expect((await getDraftItems(db, id))[0]?.quantity).toBe("8"); // local side kept
    expect(server.orders.get("order-1")?.items[0]?.quantity).toBe("2"); // server side untouched
    expect((await listOutbox(db, id))[0]?.state).toBe("conflict");
    // and it is not retried on its own
    const before = server.requests.length;
    await push();
    expect(server.requests).toHaveLength(before);
  });

  it("keep_local re-queues the seller's version against the server's version", async () => {
    const id = await syncedDraftWithLocalEdit();
    server.foreignEdit("order-1");
    await push();
    await resolveConflict(db, env, server, id, "keep_local");
    await push();
    expect(server.orders.get("order-1")?.items[0]?.quantity).toBe("8");
    expect(await getDraft(db, id)).toMatchObject({ status: "synced", remoteVersion: 3 });
  });

  it("use_server drops the local edit for the server's version", async () => {
    const id = await syncedDraftWithLocalEdit();
    server.foreignEdit("order-1");
    await push();
    await resolveConflict(db, env, server, id, "use_server");
    expect((await getDraftItems(db, id))[0]?.quantity).toBe("2");
    expect(await getDraft(db, id)).toMatchObject({ status: "synced", remoteVersion: 2, notes: "alterado por outra pessoa" });
    expect(await listOutbox(db, id)).toEqual([]);
  });
});

describe("offline price (P-09)", () => {
  it("a changed price is never replaced silently: needs_review with both prices", async () => {
    const id = await saveOrderDraft(db, env, input([item(1, "2", "10.00"), item(2, "1", "10.00")]));
    server.serverPrices.set(1, "12.50");
    await push();
    const draft = await getDraft(db, id);
    expect(draft?.status).toBe("needs_review");
    expect(draft?.priceReview).toEqual([{ productCode: 1, description: "Produto 1", cachedUnitPrice: "10.00", serverUnitPrice: "12.50" }]);
    expect(JSON.parse((await getDraftItems(db, id))[0]?.priceJson ?? "{}").unitPrice).toBe("10.00"); // still what the seller saw
    expect((await countOutbox(db, OWNER)).needsAttention).toBe(1);
  });

  it("a product that lost its price is flagged as 'Sem preço', not as 0", async () => {
    const id = await saveOrderDraft(db, env, input([item(1, "2", "10.00")]));
    server.serverPrices.set(1, null);
    await push();
    expect((await getDraft(db, id))?.priceReview?.[0]).toMatchObject({ cachedUnitPrice: "10.00", serverUnitPrice: null });
  });

  it("equal prices with different formatting do not trigger a review", async () => {
    const id = await saveOrderDraft(db, env, input([item(1, "2", "10")]));
    await push();
    expect((await getDraft(db, id))?.status).toBe("synced");
  });

  it("acknowledging adopts the server prices and clears the review", async () => {
    const id = await saveOrderDraft(db, env, input([item(1, "2", "10.00")]));
    server.serverPrices.set(1, "12.50");
    await push();
    await acknowledgePriceReview(db, env, id);
    expect(await getDraft(db, id)).toMatchObject({ status: "synced", priceReview: null });
    expect(JSON.parse((await getDraftItems(db, id))[0]?.priceJson ?? "{}").unitPrice).toBe("12.50");
    expect(await listOutbox(db, id)).toEqual([]);
  });
});

describe("discard", () => {
  it("drops a never-sent draft entirely", async () => {
    const id = await saveOrderDraft(db, env, input([item(1)]));
    await discardLocalDraft(db, OWNER, id);
    expect(await getDraft(db, id)).toBeNull();
    expect(await listOutbox(db)).toEqual([]);
    expect(await getDraftItems(db, id)).toEqual([]);
  });

  it("refuses to drop a draft whose create may exist on the server", async () => {
    const id = await saveOrderDraft(db, env, input([item(1)]));
    server.loseResponseOnce = true;
    await push();
    await expect(discardLocalDraft(db, OWNER, id)).rejects.toThrow(/já foi enviado/);
    expect(await getDraft(db, id)).not.toBeNull();
  });
});

describe("reference pull", () => {
  const source = (failProducts = false): ReferenceSource => ({
    fetchCustomers: async () => [{ code: 1, name: "Açúcar & Cia" }],
    fetchProducts: async () => {
      if (failProducts) throw new TransportError("network", "x");
      return [{ code: 10, description: "Parafuso Sextavado", groupCode: 2 }];
    },
    fetchEntryConfiguration: async () => ({ negotiationTypes: [] }),
  });

  it("replaces the cache atomically and searches without accents", async () => {
    await pullReferenceData(db, env, source(), OWNER);
    const page = await searchProducts(db, { search: "sextavado par", page: 1, pageSize: 10 });
    expect(page.total).toBe(1);
  });

  it("a failed pull leaves the previous cache intact", async () => {
    await pullReferenceData(db, env, source(), OWNER);
    await expect(pullReferenceData(db, env, source(true), OWNER)).rejects.toThrow();
    expect((await searchProducts(db, { search: "", page: 1, pageSize: 10 })).total).toBe(1);
  });
});

describe("sync manager", () => {
  const source: ReferenceSource = { fetchCustomers: async () => [], fetchProducts: async () => [], fetchEntryConfiguration: async () => null };

  it("reports offline without losing the draft, then syncs on the next run", async () => {
    await saveOrderDraft(db, env, input([item(1)]));
    const manager = createSyncManager({ db, env, transport: server, source, ownerAccountId: OWNER });
    server.failWith = "network";
    const offline = await manager.sync("manual");
    expect(offline).toMatchObject({ phase: "offline", pending: 1 });
    server.failWith = null;
    const online = await manager.sync("reconnected");
    expect(online).toMatchObject({ phase: "idle", pending: 0, needsAttention: 0 });
    expect(online.lastSyncedAt).not.toBeNull();
    expect(server.orders.size).toBe(1);
  });

  it("concurrent triggers share one run (single-flight): one order", async () => {
    await saveOrderDraft(db, env, input([item(1)]));
    const manager = createSyncManager({ db, env, transport: server, source, ownerAccountId: OWNER });
    await Promise.all([manager.sync("manual"), manager.sync("foreground"), manager.sync("timer")]);
    expect(server.requests.filter((r) => r.startsWith("POST"))).toHaveLength(1);
  });

  it("does not pull the cache when the push failed", async () => {
    await saveOrderDraft(db, env, input([item(1)]));
    let pulled = 0;
    const counting: ReferenceSource = { ...source, fetchCustomers: async () => (pulled++, []) };
    const manager = createSyncManager({ db, env, transport: server, source: counting, ownerAccountId: OWNER });
    server.failWith = "network";
    await manager.sync("manual");
    expect(pulled).toBe(0);
  });

  it("notifies subscribers", async () => {
    const manager = createSyncManager({ db, env, transport: server, source, ownerAccountId: OWNER });
    const phases: string[] = [];
    manager.subscribe((s) => phases.push(s.phase));
    await manager.sync("manual");
    expect(phases).toEqual(["syncing", "idle"]);
  });
});
