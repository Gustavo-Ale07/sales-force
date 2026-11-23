import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONFIRM_POLL_MS,
  CONFIRM_WAIT_MS,
  countDraftsByGroup,
  countOutbox,
  countSendRequests,
  createPendingCustomer,
  createSyncManager,
  DraftNotEditableError,
  getDraft,
  getOrderErpStatuses,
  listAttentionItems,
  listOutbox,
  migrations,
  queryDrafts,
  readSchemaVersion,
  refreshOrderErpStatuses,
  requestOrderSend,
  runMigrations,
  saveOrderDraft,
  TransportError,
  type CustomerRegistrationTransport,
  type DraftErpStage,
  type DraftItemInput,
  type OfflineEnv,
  type OrderCommandPayload,
  type OrderErpStatus,
  type OrderTransport,
  type ReferenceSource,
  type RemoteOrder,
  type SaveDraftInput,
  type SqlDatabase,
  type SubmittedOrder,
  type SyncManager,
  type TransportErrorKind,
} from "../src/index";
import { confirm, REAL } from "./helpers";
import { openNodeDatabase } from "./node-sqlite-connection";

const OWNER = "acct-1";

let t = Date.parse("2026-11-20T12:00:00.000Z");
let seq = 0;
const env: OfflineEnv = { now: () => new Date(t), newId: () => `id-${String(++seq).padStart(5, "0")}` };

const item = (productCode = 1, quantity = "2"): DraftItemInput => ({
  productCode,
  description: `Produto ${productCode}`,
  unit: "UN",
  quantity,
  discountPercent: "0",
  priceJson: JSON.stringify({ state: "priced", unitPrice: "10.00" }),
  groupCode: 1,
  groupName: "G",
});
const input = (extra: Partial<SaveDraftInput> = {}): SaveDraftInput => ({
  ownerAccountId: OWNER,
  customerCode: 77,
  customerName: "Cliente 77",
  negotiationTypeCode: null,
  notes: null,
  items: [item()],
  loadedDataset: REAL,
  ...extra,
});

const fail = (kind: TransportErrorKind, reason?: string, status = 0) => new TransportError(kind, "falha", status, reason);

/** Server stand-in: idempotent create, version-checked replace, scripted submit. */
class SendServer implements OrderTransport {
  log: string[];
  orders = new Map<string, RemoteOrder>();
  byKey = new Map<string, string>();
  submitCalls: string[] = [];
  /** Outcomes of submit, consumed in order; the LAST one repeats. Empty = `queued`. */
  submitScript: (SubmittedOrder | TransportError)[] = [];
  createError: TransportError | null = null;
  replaceError: TransportError | null = null;
  submitHang = false;
  private n = 0;
  constructor(log: string[]) {
    this.log = log;
  }
  private build(id: string, version: number, draftNumber: number, request: OrderCommandPayload["request"]): RemoteOrder {
    return {
      id,
      version,
      draftNumber,
      customerCode: request.customerCode,
      customerName: "Cliente",
      negotiationTypeCode: request.negotiationTypeCode,
      topCode: request.topCode ?? null,
      carrierCode: request.carrierCode ?? null,
      notes: request.notes,
      estimatedTotal: "0.00",
      items: request.items.map((line) => ({
        productCode: line.productCode,
        productDescription: `Produto ${line.productCode}`,
        unit: "UN",
        quantity: line.quantity,
        unitListPrice: "10.00",
        priceState: "priced" as const,
        priceTableCode: 1,
        priceVersionId: 1,
        discountPercent: line.discountPercent ?? "0",
      })),
    };
  }
  async createOrder(key: string, request: OrderCommandPayload["request"]): Promise<RemoteOrder> {
    this.log.push("POST");
    if (this.createError !== null) throw this.createError;
    const known = this.byKey.get(key);
    if (known !== undefined) return this.orders.get(known) as RemoteOrder;
    const id = `order-${++this.n}`;
    const order = this.build(id, 1, this.n, request);
    this.orders.set(id, order);
    this.byKey.set(key, id);
    return order;
  }
  async replaceOrder(id: string, expectedVersion: number, request: OrderCommandPayload["request"]): Promise<RemoteOrder> {
    this.log.push("PUT");
    if (this.replaceError !== null) throw this.replaceError;
    const current = this.orders.get(id);
    if (current === undefined) throw fail("not_found", undefined, 404);
    if (current.version !== expectedVersion) throw fail("version_conflict", undefined, 409);
    const next = this.build(id, current.version + 1, current.draftNumber, request);
    this.orders.set(id, next);
    return next;
  }
  async submitOrder(id: string): Promise<SubmittedOrder> {
    this.log.push(`submit ${id}`);
    this.submitCalls.push(id);
    if (this.submitHang) return new Promise<never>(() => undefined);
    const next = this.submitScript.length > 1 ? this.submitScript.shift() : this.submitScript[0];
    if (next instanceof TransportError) throw next;
    const answer = next ?? { status: "queued", version: (this.orders.get(id)?.version ?? 1) + 1, erpNumber: null };
    const current = this.orders.get(id);
    if (current !== undefined) this.orders.set(id, { ...current, version: answer.version }); // the server bumps the version when it takes the order
    return answer;
  }
  async getOrder(id: string): Promise<RemoteOrder> {
    const order = this.orders.get(id);
    if (order === undefined) throw fail("not_found", undefined, 404);
    return order;
  }
  foreignEdit(id: string): void {
    const current = this.orders.get(id) as RemoteOrder;
    this.orders.set(id, { ...current, version: current.version + 1, notes: "outra pessoa" });
  }
}

let db: SqlDatabase;
let log: string[];
let server: SendServer;
let internet: "online" | "offline" | "unknown";
let unexpected: unknown[];
let statuses: (ids: readonly string[]) => Promise<readonly OrderErpStatus[]>;
let statusCalls: string[][];

const makeSource = (over: Partial<ReferenceSource> = {}): ReferenceSource => ({
  fetchCustomers: async () => {
    log.push("pull");
    return [];
  },
  fetchProducts: async () => [],
  fetchEntryConfiguration: async () => ({ general: { enabled: true } }),
  fetchDatasetIdentity: async () => REAL,
  fetchOrderStatuses: async (ids) => {
    statusCalls.push([...ids]);
    return statuses(ids);
  },
  ...over,
});

let customerTransport: CustomerRegistrationTransport | undefined;
const mk = (over: { source?: ReferenceSource; transport?: OrderTransport } = {}): SyncManager =>
  createSyncManager({
    db,
    env,
    transport: over.transport ?? server,
    source: over.source ?? makeSource(),
    ownerAccountId: OWNER,
    internetState: () => internet,
    onUnexpectedError: (e) => unexpected.push(e),
    ...(customerTransport === undefined ? {} : { customerTransport }),
  });

const send = (extra: Partial<SaveDraftInput> = {}) => saveOrderDraft(db, env, input({ sendRequested: true, ...extra }));
const pushOnly = (mgr: SyncManager, reason: "manual" | "timer" | "after_save" = "manual") => mgr.sync(reason, { pull: false });

beforeEach(async () => {
  t = Date.parse("2026-11-20T12:00:00.000Z");
  db = openNodeDatabase();
  await runMigrations(db, migrations);
  await confirm(db);
  log = [];
  server = new SendServer(log);
  internet = "online";
  unexpected = [];
  statuses = async () => [];
  statusCalls = [];
  customerTransport = undefined;
});

/* ---------------------------------------------------------------- migrations */

describe("migrations v10 (order_send_request) and v11 (order_erp_stage)", () => {
  const columnsOf = async (d: SqlDatabase, table: string) => (await d.query<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name);

  it("apply from v9 over a database that already holds drafts, keeping every row and column (expand-only)", async () => {
    const old = openNodeDatabase();
    await runMigrations(old, migrations.filter((m) => m.version <= 9));
    expect(await readSchemaVersion(old)).toBe(9);
    await confirm(old);
    const id = await saveOrderDraft(old, env, input());
    const tablesBefore = (await old.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")).map((r) => r.name).sort();
    const before = await old.query("SELECT * FROM local_order_draft");
    const columnsBefore = await columnsOf(old, "local_order_draft");
    const itemsBefore = await old.query("SELECT * FROM local_order_item");
    const outboxBefore = await old.query("SELECT * FROM outbox");
    expect(columnsBefore).not.toContain("send_state");

    const report = await runMigrations(old, migrations);
    expect(report).toEqual({ from: 9, to: 12, applied: [10, 11, 12] });

    const columnsAfter = await columnsOf(old, "local_order_draft");
    expect(columnsAfter).toEqual(expect.arrayContaining([...columnsBefore, "send_state", "send_code", "send_error", "send_attempts", "send_next_attempt_at", "send_requested_at", "erp_stage", "erp_stage_json", "erp_number"]));
    expect(columnsAfter).toHaveLength(columnsBefore.length + 9);
    // old values untouched
    const [row] = (await old.query("SELECT * FROM local_order_draft")) as Record<string, unknown>[];
    for (const [key, value] of Object.entries((before as Record<string, unknown>[])[0] as Record<string, unknown>)) expect(row?.[key]).toEqual(value);
    expect(await old.query("SELECT * FROM local_order_item")).toEqual(itemsBefore);
    expect(await old.query("SELECT * FROM outbox")).toEqual(outboxBefore);
    expect((await old.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")).map((r) => r.name).sort()).toEqual(tablesBefore);
    // defaults for the pre-existing row
    expect(await getDraft(old, id)).toMatchObject({ sendState: null, sendCode: null, sendError: null, sendAttempts: 0, sendNextAttemptAt: null, sendRequestedAt: null, erpStage: null, erpNumber: null });
    // the old draft is still editable and a send request can be recorded on it
    await requestOrderSend(old, env, OWNER, id);
    expect((await getDraft(old, id))?.sendState).toBe("requested");
  });

  it("is idempotent and the schema version ends at 12", async () => {
    expect(await readSchemaVersion(db)).toBe(12);
    expect((await runMigrations(db, migrations)).applied).toEqual([]);
  });

  it("send_state accepts only NULL / requested / refused / submitted", async () => {
    const id = await saveOrderDraft(db, env, input());
    for (const ok of ["requested", "refused", "submitted"]) await db.execute("UPDATE local_order_draft SET send_state = ? WHERE local_id = ?", [ok, id]);
    await db.execute("UPDATE local_order_draft SET send_state = NULL WHERE local_id = ?", [id]);
    await expect(db.execute("UPDATE local_order_draft SET send_state = 'sent' WHERE local_id = ?", [id])).rejects.toThrow();
  });
});

/* ---------------------------------------------------------------- save / persist */

describe("the send request lives with the draft", () => {
  it("is persisted on create with a fresh counter and its timestamp, and no extra outbox command", async () => {
    const id = await send();
    expect(await getDraft(db, id)).toMatchObject({ sendState: "requested", sendCode: null, sendError: null, sendAttempts: 0, sendNextAttemptAt: null, sendRequestedAt: new Date(t).toISOString() });
    expect((await listOutbox(db, id)).map((o) => o.type)).toEqual(["order.create"]);
  });

  it("a plain save (sendRequested absent) records no request", async () => {
    const id = await saveOrderDraft(db, env, input());
    expect((await getDraft(db, id))?.sendState).toBeNull();
  });

  it("double tap on Confirmar (same payload, still unsent): same id, no new command, no new row, request untouched", async () => {
    const id = await send();
    const key = (await getDraft(db, id))?.clientRequestId;
    t += 5000;
    const again = await send({ localId: id });
    expect(again).toBe(id);
    const ops = await listOutbox(db, id);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.idempotencyKey).toBe(key);
    const drafts = await db.query<{ n: number }>("SELECT count(*) AS n FROM local_order_draft");
    expect(Number(drafts[0]?.n)).toBe(1);
    const all = await db.query<{ n: number }>("SELECT count(*) AS n FROM outbox");
    expect(Number(all[0]?.n)).toBe(1);
    expect((await getDraft(db, id))?.sendRequestedAt).toBe("2026-11-20T12:00:00.000Z");
  });

  it("replay after the create was accepted: same id, still one local order and one server order (a replace of identical data is harmless; see report)", async () => {
    const id = await send();
    await pushOnly(mk());
    await db.execute("UPDATE local_order_draft SET send_state = 'requested', send_code = NULL WHERE local_id = ?", [id]);
    expect(await send({ localId: id })).toBe(id);
    const rows = await db.query<{ n: number }>("SELECT count(*) AS n FROM local_order_draft");
    expect(Number(rows[0]?.n)).toBe(1);
    expect(log.filter((l) => l === "POST")).toHaveLength(1);
    expect(server.orders.size).toBe(1);
  });

  it("a changed payload with the request still waiting is saved (coalesced into the unsent create), not ignored", async () => {
    const id = await send();
    await send({ localId: id, items: [item(1, "9")] });
    const ops = await listOutbox(db, id);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.payload.request.items[0]?.quantity).toBe("9");
    expect((await getDraft(db, id))?.sendState).toBe("requested");
  });

  it("sendRequested false cancels the request; an edit of a refused/submitted one clears the old answer", async () => {
    const id = await send();
    await saveOrderDraft(db, env, input({ localId: id, sendRequested: false }));
    expect(await getDraft(db, id)).toMatchObject({ sendState: null, sendRequestedAt: null });

    await db.execute("UPDATE local_order_draft SET send_state = 'refused', send_code = 'customer_without_seller', send_error = 'x' WHERE local_id = ?", [id]);
    await saveOrderDraft(db, env, input({ localId: id, items: [item(1, "3")] }));
    expect(await getDraft(db, id)).toMatchObject({ sendState: null, sendCode: null, sendError: null });
  });

  it("an order the server took and is processing is read-only; one awaiting approval may be edited and goes back to unsent", async () => {
    const id = await send();
    await db.execute("UPDATE local_order_draft SET send_state = 'submitted', send_code = 'queued' WHERE local_id = ?", [id]);
    await expect(saveOrderDraft(db, env, input({ localId: id, items: [item(1, "3")] }))).rejects.toBeInstanceOf(DraftNotEditableError);
    await db.execute("UPDATE local_order_draft SET send_code = 'awaiting_approval' WHERE local_id = ?", [id]);
    await saveOrderDraft(db, env, input({ localId: id, items: [item(1, "3")] }));
    expect((await getDraft(db, id))?.sendState).toBeNull();
  });

  it("requestOrderSend re-requests a refused order, never a read-only sent one, never another account's", async () => {
    const id = await send();
    await db.execute("UPDATE local_order_draft SET send_state = 'refused', send_code = 'x', send_attempts = 3 WHERE local_id = ?", [id]);
    await requestOrderSend(db, env, OWNER, id);
    expect(await getDraft(db, id)).toMatchObject({ sendState: "requested", sendAttempts: 0, sendCode: null });
    await db.execute("UPDATE local_order_draft SET send_state = 'submitted', send_code = 'sent' WHERE local_id = ?", [id]);
    await requestOrderSend(db, env, OWNER, id);
    expect((await getDraft(db, id))?.sendState).toBe("submitted");
    await expect(requestOrderSend(db, env, "other", id)).rejects.toBeInstanceOf(DraftNotEditableError);
  });
});

/* ---------------------------------------------------------------- sync manager order */

describe("SyncManager order: customers, outbox push, submit, pull", () => {
  it("runs customers, then create/replace, then submit, then the pull", async () => {
    customerTransport = {
      createCustomer: async () => {
        log.push("customer");
        return { registrationId: "r", status: "pending", customerCode: null };
      },
      getCustomer: async () => {
        throw fail("not_found");
      },
    };
    await createPendingCustomer(db, env, {
      ownerAccountId: OWNER,
      request: { document: "12345678909", name: "Novo", tradeName: null, icmsClassification: "R", stateRegistration: null, phone: null, email: null, notes: null, addresses: [{ streetCode: 1, neighborhoodCode: 2, number: "1", complement: null, postalCode: "01001000" }] },
    });
    await send();
    const status = await mk().sync("manual");
    expect(log).toEqual(["customer", "POST", "submit order-1", "pull"]);
    expect(status.failure).toBeNull();
  });

  it("the create and the replace go before the submit; the submit goes after the last replace", async () => {
    const id = await send();
    server.createError = fail("network");
    await pushOnly(mk());
    server.createError = null;
    log.length = 0;
    await send({ localId: id, items: [item(1, "5")] }); // frozen create + replace behind it? (create was attempted)
    await pushOnly(mk());
    expect(log).toEqual(["POST", "PUT", "submit order-1"]);
  });

  it("does not submit while the order is not on the server (create failing): nothing is lost, the request waits", async () => {
    const id = await send();
    server.createError = fail("server", undefined, 503);
    await pushOnly(mk());
    expect(server.submitCalls).toEqual([]);
    expect(await getDraft(db, id)).toMatchObject({ sendState: "requested", sendAttempts: 0, remoteId: null });
  });

  it("does not submit while its outbox is not empty (replace failing), then submits once it is delivered", async () => {
    const id = await send();
    await pushOnly(mk()); // create accepted + submitted
    // simulate: a new request while a replace is still queued and failing
    await db.execute("UPDATE local_order_draft SET send_state = NULL, send_code = NULL WHERE local_id = ?", [id]);
    await saveOrderDraft(db, env, input({ localId: id, items: [item(1, "7")], sendRequested: true }));
    server.replaceError = fail("server", undefined, 500);
    const before = server.submitCalls.length;
    await pushOnly(mk());
    expect(server.submitCalls).toHaveLength(before);
    expect((await listOutbox(db, id)).length).toBeGreaterThan(0);
    server.replaceError = null;
    await pushOnly(mk());
    expect(server.submitCalls).toHaveLength(before + 1);
    expect(log.slice(-2)).toEqual(["PUT", `submit order-1`]);
    expect((await getDraft(db, id))?.sendState).toBe("submitted");
  });

  it("an order never requested to send is never submitted", async () => {
    await saveOrderDraft(db, env, input());
    await mk().sync("manual");
    expect(server.submitCalls).toEqual([]);
  });

  it("records the server's answer on the draft (code = server status, attempts, version) and counts nothing as waiting afterwards", async () => {
    const id = await send();
    server.submitScript = [{ status: "queued", version: 5, erpNumber: null }];
    await pushOnly(mk());
    expect(await getDraft(db, id)).toMatchObject({ sendState: "submitted", sendCode: "queued", sendAttempts: 1, remoteVersion: 5, sendError: null, sendNextAttemptAt: null });
    expect(await countSendRequests(db, OWNER, REAL)).toEqual({ waiting: 0, refused: 0 });
  });

  it("repeated runs never submit a taken order again (no duplicate delivery)", async () => {
    await send();
    const mgr = mk();
    for (let i = 0; i < 4; i += 1) await mgr.sync("manual");
    expect(server.submitCalls).toEqual(["order-1"]);
    expect(log.filter((l) => l === "POST")).toHaveLength(1);
  });

  it("a re-requested order the server already holds is answered with the same state (still one delivery, one create)", async () => {
    const id = await send();
    server.submitScript = [{ status: "sent", version: 2, erpNumber: 55 }];
    const mgr = mk();
    await pushOnly(mgr);
    await db.execute("UPDATE local_order_draft SET send_state = 'requested', send_code = NULL WHERE local_id = ?", [id]);
    await pushOnly(mgr);
    expect(server.submitCalls).toEqual(["order-1", "order-1"]);
    expect(await getDraft(db, id)).toMatchObject({ sendState: "submitted", sendCode: "sent" });
    expect(log.filter((l) => l === "POST")).toHaveLength(1);
  });

  it("awaiting_approval is stored as the server status and is not a waiting or refused request", async () => {
    const id = await send();
    server.submitScript = [{ status: "awaiting_approval", version: 2, erpNumber: null }];
    const status = await pushOnly(mk());
    expect(await getDraft(db, id)).toMatchObject({ sendState: "submitted", sendCode: "awaiting_approval" });
    expect(status.awaitingOrders).toBe(0);
    expect(status.needsAttention).toBe(0);
  });

  it.each(["login", "reconnected", "manual", "foreground", "timer", "after_save"] as const)("a request made offline is delivered by a '%s' sync once online", async (reason) => {
    const id = await send();
    server.createError = fail("network");
    internet = "offline";
    const first = await mk().sync("manual", { pull: false });
    expect(first.failure).toBe("no_internet");
    expect(server.submitCalls).toEqual([]);
    expect((await getDraft(db, id))?.sendState).toBe("requested");
    server.createError = null;
    internet = "online";
    t += 60 * 60_000; // past any backoff
    await mk().sync(reason, { pull: reason === "login" || reason === "reconnected" });
    expect(await getDraft(db, id)).toMatchObject({ sendState: "submitted" });
    expect(server.submitCalls).toEqual(["order-1"]);
  });
});

/* ---------------------------------------------------------------- failure classification */

describe("submit failures", () => {
  it.each([
    ["network", 0],
    ["server", 503],
    ["server", 500],
    ["rate_limit", 429],
  ] as const)("transient '%s' (%i) keeps the request queued with backoff and it IS resent", async (kind, status) => {
    const id = await send();
    server.submitScript = [fail(kind, undefined, status), { status: "queued", version: 2, erpNumber: null }];
    const mgr = mk();
    const first = await pushOnly(mgr);
    expect(server.submitCalls).toHaveLength(1);
    expect(await getDraft(db, id)).toMatchObject({ sendState: "requested", sendAttempts: 1, sendNextAttemptAt: new Date(t + 5000).toISOString() });
    // 5xx/429: "Sankhya indisponível" (offline phase, never "Erro ao sincronizar"); the order stays queued
    expect(first.phase).toBe("offline");
    if (kind !== "network") expect(first.failure).toBe("sankhya_unavailable");
    expect(first.awaitingOrders).toBe(1);
    // the automatic timer respects the backoff window ...
    await pushOnly(mgr, "timer");
    expect(server.submitCalls).toHaveLength(1);
    // ... and fires once it elapsed
    t += 5000;
    const third = await pushOnly(mgr, "timer");
    expect(server.submitCalls).toHaveLength(2);
    expect(await getDraft(db, id)).toMatchObject({ sendState: "submitted", sendAttempts: 2 });
    expect(third.phase).toBe("idle");
  });

  it("repeated transient failures double the delay each time (5 s, 10 s, 20 s) and a manual sync ignores the window", async () => {
    const id = await send();
    server.submitScript = [fail("server", undefined, 503)];
    const mgr = mk();
    await pushOnly(mgr);
    expect((await getDraft(db, id))?.sendNextAttemptAt).toBe(new Date(t + 5000).toISOString());
    await pushOnly(mgr); // manual: no window
    expect(await getDraft(db, id)).toMatchObject({ sendAttempts: 2, sendNextAttemptAt: new Date(t + 10_000).toISOString() });
    await pushOnly(mgr);
    expect((await getDraft(db, id))?.sendNextAttemptAt).toBe(new Date(t + 20_000).toISOString());
    expect(server.submitCalls).toHaveLength(3);
  });

  it("401 keeps the request queued with no backoff, ends the run as auth_required, and is resent after the new login", async () => {
    const id = await send();
    server.submitScript = [fail("auth", undefined, 401), { status: "queued", version: 2, erpNumber: null }];
    const mgr = mk();
    const first = await pushOnly(mgr);
    expect(first).toMatchObject({ phase: "auth_required", failure: "auth" });
    expect(await getDraft(db, id)).toMatchObject({ sendState: "requested", sendAttempts: 1, sendNextAttemptAt: null });
    await pushOnly(mgr, "timer"); // no backoff to wait for
    expect(server.submitCalls).toHaveLength(2);
    expect((await getDraft(db, id))?.sendState).toBe("submitted");
  });

  it.each([
    ["customer_ineligible", "customer_without_seller"],
    ["customer_ineligible", "customer_blocked"],
    ["send_refused", "erp_submission_disabled"],
    ["send_refused", "some_reason_nobody_knows_yet"],
    ["send_refused", undefined],
    ["validation", undefined],
    ["not_editable", undefined],
    ["not_found", undefined],
  ] as const)("definitive refusal '%s'/%s: refused with the code, NOT retried (exactly one call across many runs), run is clean", async (kind, reason) => {
    const id = await send();
    server.submitScript = [fail(kind, reason, 422)];
    const mgr = mk();
    const first = await pushOnly(mgr);
    expect(first.failure).toBeNull();
    expect(first.phase).toBe("idle");
    const draft = await getDraft(db, id);
    expect(draft).toMatchObject({ sendState: "refused", sendCode: reason ?? "send_refused", sendNextAttemptAt: null, sendAttempts: 1 });
    expect(draft?.sendError).toEqual(expect.any(String));
    for (let i = 0; i < 3; i += 1) {
      await mgr.sync("manual");
      await mgr.sync("timer", { pull: false });
    }
    expect(server.submitCalls).toHaveLength(1);
  });

  it("a refusal needs the seller (popup path): failure null, but the counters and the attention list say so; only the seller re-requests", async () => {
    const id = await send();
    server.submitScript = [fail("send_refused", "customer_without_seller", 422), { status: "queued", version: 2, erpNumber: null }];
    const mgr = mk();
    const status = await pushOnly(mgr);
    expect(status).toMatchObject({ failure: null, phase: "idle", needsAttention: 1, awaitingOrders: 1 });
    expect(status.attention?.map((a) => a.localId)).toEqual([id]);
    expect((await listAttentionItems(db, OWNER))[0]?.reason).toEqual(expect.any(String));
    await requestOrderSend(db, env, OWNER, id);
    await pushOnly(mgr);
    expect(server.submitCalls).toHaveLength(2);
    expect((await getDraft(db, id))?.sendState).toBe("submitted");
  });

  it("a refusal of one order does not block the next one in the queue", async () => {
    const a = await send();
    t += 1000;
    const b = await send({ customerCode: 88, customerName: "Outro" });
    server.submitScript = [fail("send_refused", "customer_without_seller", 422), { status: "queued", version: 2, erpNumber: null }];
    await pushOnly(mk());
    expect((await getDraft(db, a))?.sendState).toBe("refused");
    expect((await getDraft(db, b))?.sendState).toBe("submitted");
    expect(server.submitCalls).toEqual(["order-1", "order-2"]);
  });

  it("a non-transport exception is treated as transient (never as a definitive refusal) and reported", async () => {
    const id = await send();
    const odd: OrderTransport = { ...server, createOrder: server.createOrder.bind(server), replaceOrder: server.replaceOrder.bind(server), getOrder: server.getOrder.bind(server), submitOrder: async () => { throw new Error("boom"); } };
    await pushOnly(mk({ transport: odd }));
    expect((await getDraft(db, id))?.sendState).toBe("requested");
    expect(unexpected).toHaveLength(1);
  });
});

/* ---------------------------------------------------------------- counters */

describe("counters", () => {
  it("awaitingOrders = requests waiting + refused ones; pending counts the waiting ones; submitted ones count in neither", async () => {
    await send(); // waiting
    await send({ customerCode: 2, customerName: "B" }); // waiting
    const c = await send({ customerCode: 3, customerName: "C" });
    await db.execute("UPDATE local_order_draft SET send_state = 'refused', send_code = 'x' WHERE local_id = ?", [c]);
    const d = await send({ customerCode: 4, customerName: "D" });
    await db.execute("UPDATE local_order_draft SET send_state = 'submitted', send_code = 'queued' WHERE local_id = ?", [d]);
    const status = await mk().refresh();
    expect(status.awaitingOrders).toBe(3);
    expect(status.needsAttention).toBe(1);
    expect(await countSendRequests(db, OWNER, REAL)).toEqual({ waiting: 2, refused: 1 });
  });

  it("only the current dataset's and the current account's requests count", async () => {
    const id = await send();
    await db.execute("UPDATE local_order_draft SET dataset_id = 'another' WHERE local_id = ?", [id]);
    expect(await countSendRequests(db, OWNER, REAL)).toEqual({ waiting: 0, refused: 0 });
    expect(await countSendRequests(db, "someone-else", REAL)).toEqual({ waiting: 0, refused: 0 });
    expect(await countSendRequests(db, OWNER)).toEqual({ waiting: 1, refused: 0 });
  });
});

/* ---------------------------------------------------------------- confirmOrder */

describe("SyncManager.confirmOrder", () => {
  const fakeSleep = () => {
    const calls: number[] = [];
    return {
      calls,
      /** Poll sleeps advance the clock; the wait-window race sleep (the full window) never wins, so the delivery decides. */
      sleep: async (ms: number): Promise<void> => {
        calls.push(ms);
        if (ms >= CONFIRM_WAIT_MS) return new Promise<void>(() => undefined);
        t += ms;
      },
    };
  };
  const number = (n: number | null, over: Partial<OrderErpStatus> = {}): OrderErpStatus => ({ orderId: "order-1", erpNumber: n, code: null, label: null, invoiceNumber: null, checkedAt: null, ...over });

  it("exposes the documented window (8 s) and poll (1.5 s)", () => {
    expect(CONFIRM_WAIT_MS).toBe(8000);
    expect(CONFIRM_POLL_MS).toBe(1500);
  });

  it("sent: the Sankhya number appears on the 3rd read; reads every 1.5 s, one id per read", async () => {
    const id = await send();
    let reads = 0;
    statuses = async () => [number(++reads >= 3 ? 1234 : null)];
    const s = fakeSleep();
    const outcome = await mk().confirmOrder?.(id, { sleep: s.sleep });
    expect(outcome).toEqual({ kind: "sent", erpNumber: 1234 });
    expect(reads).toBe(3);
    expect(statusCalls).toEqual([["order-1"], ["order-1"], ["order-1"]]);
    expect(s.calls.filter((ms) => ms === 1500)).toHaveLength(2);
    expect(server.submitCalls).toEqual(["order-1"]);
  });

  it("sent immediately when the first read already has the number (no sleep between reads)", async () => {
    const id = await send();
    statuses = async () => [number(777)];
    const s = fakeSleep();
    expect(await mk().confirmOrder?.(id, { sleep: s.sleep })).toEqual({ kind: "sent", erpNumber: 777 });
    expect(s.calls.filter((ms) => ms < CONFIRM_WAIT_MS)).toEqual([]);
  });

  it("sending: the number does not arrive inside the window; it ends before 8 s elapsed and keeps nothing running", async () => {
    const id = await send();
    statuses = async () => [number(null)];
    const s = fakeSleep();
    const started = t;
    const outcome = await mk().confirmOrder?.(id, { sleep: s.sleep });
    expect(outcome).toEqual({ kind: "sending" });
    expect(t - started).toBeLessThanOrEqual(CONFIRM_WAIT_MS);
    expect(t - started).toBeGreaterThanOrEqual(CONFIRM_WAIT_MS - CONFIRM_POLL_MS);
    expect(statusCalls.length).toBeGreaterThanOrEqual(5);
    expect((await getDraft(db, id))?.sendState).toBe("submitted");
  });

  it("sending with the real timers (fake timer clock): resolves inside the 8 s window", async () => {
    vi.useFakeTimers();
    try {
      const realEnv: OfflineEnv = { now: () => new Date(Date.now()), newId: env.newId };
      const id = await saveOrderDraft(db, realEnv, input({ sendRequested: true }));
      statuses = async () => [number(null)];
      const mgr = createSyncManager({ db, env: realEnv, transport: server, source: makeSource(), ownerAccountId: OWNER, internetState: () => "online" });
      let done: unknown = "pending";
      const p = mgr.confirmOrder?.(id).then((o) => (done = o));
      await vi.advanceTimersByTimeAsync(CONFIRM_WAIT_MS - CONFIRM_POLL_MS - 1);
      expect(done).toBe("pending"); // still waiting, never released early
      await vi.advanceTimersByTimeAsync(CONFIRM_POLL_MS + 1);
      await p;
      expect(done).toEqual({ kind: "sending" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("awaiting_approval when the server holds the order for a manager", async () => {
    const id = await send();
    server.submitScript = [{ status: "awaiting_approval", version: 2, erpNumber: null }];
    expect(await mk().confirmOrder?.(id, { sleep: fakeSleep().sleep })).toEqual({ kind: "awaiting_approval" });
    expect(statusCalls).toEqual([]); // no Sankhya number to wait for
  });

  it("approval_rejected is refused with edit_before_resubmitting", async () => {
    const id = await send();
    server.submitScript = [{ status: "approval_rejected", version: 2, erpNumber: null }];
    expect(await mk().confirmOrder?.(id, { sleep: fakeSleep().sleep })).toEqual({ kind: "refused", code: "edit_before_resubmitting", message: null });
  });

  it("queued when offline: nothing is sent, the request stays, and it is resent on reconnect", async () => {
    const id = await send();
    internet = "offline";
    const mgr = mk();
    expect(await mgr.confirmOrder?.(id, { sleep: fakeSleep().sleep })).toEqual({ kind: "queued" });
    expect(log).toEqual([]);
    expect((await getDraft(db, id))?.sendState).toBe("requested");
    internet = "online";
    await mgr.sync("reconnected", { pull: false });
    expect((await getDraft(db, id))?.sendState).toBe("submitted");
  });

  it.each([
    ["create: network", () => (server.createError = fail("network"))],
    ["create: 503", () => (server.createError = fail("server", undefined, 503))],
    ["create: 401", () => (server.createError = fail("auth", undefined, 401))],
    ["create: 429", () => (server.createError = fail("rate_limit", undefined, 429))],
    ["submit: network", () => (server.submitScript = [fail("network")])],
    ["submit: 503", () => (server.submitScript = [fail("server", undefined, 503)])],
    ["submit: 401", () => (server.submitScript = [fail("auth", undefined, 401)])],
    ["submit: 429", () => (server.submitScript = [fail("rate_limit", undefined, 429)])],
  ] as const)("queued on a transient failure (%s): kept for resend, later delivered", async (_name, arrange) => {
    const id = await send();
    arrange();
    const mgr = mk();
    const unavailable = /503|429/.test(_name);
    expect(await mgr.confirmOrder?.(id, { sleep: fakeSleep().sleep })).toEqual(unavailable ? { kind: "queued", reason: "sankhya_unavailable" } : { kind: "queued" });
    expect((await getDraft(db, id))?.sendState).toBe("requested");
    server.createError = null;
    server.submitScript = [];
    t += 60 * 60_000;
    await mgr.sync("manual", { pull: false });
    expect((await getDraft(db, id))?.sendState).toBe("submitted");
  });

  it("queued when the server does not answer inside the window; the late request still goes on the queue", async () => {
    const id = await send();
    server.submitHang = true;
    const mgr = mk();
    const outcome = await mgr.confirmOrder?.(id, {
      sleep: async (ms) => {
        if (ms >= CONFIRM_WAIT_MS) {
          while (server.submitCalls.length === 0) await new Promise((r) => setTimeout(r, 0));
          t += ms;
        } else t += ms;
      },
    });
    expect(outcome).toEqual({ kind: "queued" });
    expect((await getDraft(db, id))?.sendState).toBe("requested");
  });

  it.each([
    ["customer_ineligible", "customer_without_seller"],
    ["send_refused", "erp_submission_disabled"],
    ["send_refused", "reason_from_the_future"],
  ] as const)("refused (definitive '%s'/%s): code carried, exactly one submit, no resend loop", async (kind, reason) => {
    const id = await send();
    server.submitScript = [fail(kind, reason, 422)];
    const mgr = mk();
    const outcome = await mgr.confirmOrder?.(id, { sleep: fakeSleep().sleep });
    expect(outcome).toMatchObject({ kind: "refused", code: reason });
    expect((outcome as { message: string | null }).message).toEqual(expect.any(String));
    await mgr.sync("manual");
    await mgr.sync("manual", { pull: false });
    expect(server.submitCalls).toHaveLength(1);
  });

  it("refused without a code when the create/replace itself was rejected (local/outbox problem)", async () => {
    const id = await send();
    server.createError = fail("validation", undefined, 422);
    const outcome = await mk().confirmOrder?.(id, { sleep: fakeSleep().sleep });
    expect(outcome).toMatchObject({ kind: "refused", code: null });
    expect(server.submitCalls).toEqual([]);
  });

  it("refused as version_conflict when the order was changed by someone else", async () => {
    const id = await send();
    const mgr = mk();
    await mgr.confirmOrder?.(id, { sleep: fakeSleep().sleep });
    server.foreignEdit("order-1");
    await db.execute("UPDATE local_order_draft SET send_state = NULL, send_code = NULL WHERE local_id = ?", [id]);
    await saveOrderDraft(db, env, input({ localId: id, items: [item(1, "6")], sendRequested: true }));
    const outcome = await mgr.confirmOrder?.(id, { sleep: fakeSleep().sleep });
    expect(outcome).toMatchObject({ kind: "refused", code: "version_conflict" });
  });

  it("a double tap on Confirmar neither duplicates the order nor submits twice", async () => {
    const id = await send();
    statuses = async () => [number(10)];
    const mgr = mk();
    const [a, b] = await Promise.all([mgr.confirmOrder?.(id, { sleep: fakeSleep().sleep }), mgr.confirmOrder?.(id, { sleep: fakeSleep().sleep })]);
    expect(a).toEqual({ kind: "sent", erpNumber: 10 });
    expect(b).toEqual({ kind: "sent", erpNumber: 10 });
    expect(server.submitCalls).toEqual(["order-1"]);
    expect(log.filter((l) => l === "POST")).toHaveLength(1);
    const rows = await db.query<{ n: number }>("SELECT count(*) AS n FROM local_order_draft");
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it("confirming after the order is already sent just reads the number again (no second submit)", async () => {
    const id = await send();
    statuses = async () => [number(10)];
    const mgr = mk();
    await mgr.confirmOrder?.(id, { sleep: fakeSleep().sleep });
    expect(await mgr.confirmOrder?.(id, { sleep: fakeSleep().sleep })).toEqual({ kind: "sent", erpNumber: 10 });
    expect(server.submitCalls).toHaveLength(1);
  });

  it("read failures while waiting never throw: transport errors are retried inside the window, others are logged", async () => {
    const id = await send();
    let n = 0;
    statuses = async () => {
      n += 1;
      if (n === 1) throw fail("network");
      if (n === 2) throw new Error("boom");
      return [number(42)];
    };
    expect(await mk().confirmOrder?.(id, { sleep: fakeSleep().sleep })).toEqual({ kind: "sent", erpNumber: 42 });
    expect(unexpected).toHaveLength(1);
  });

  it("an unknown order id is queued, never an exception", async () => {
    expect(await mk().confirmOrder?.("nope", { sleep: fakeSleep().sleep })).toEqual({ kind: "queued" });
  });

  it("the Sankhya number is stored on the draft (status read, also from the stage's nunota) and never cleared by a later read without it", async () => {
    const id = await send();
    statuses = async () => [number(null, { stage: { stage: "received", label: "Recebido", pendingSector: null, nunota: 2511, invoiceNumber: null, updatedAt: "2026-11-20T11:00:00.000Z", checkedAt: null, readError: null } })];
    expect(await mk().confirmOrder?.(id, { sleep: fakeSleep().sleep })).toEqual({ kind: "sent", erpNumber: 2511 });
    expect((await getDraft(db, id))?.erpNumber).toBe(2511);
    statuses = async () => [number(null)];
    expect(await mk().readOrderNumber?.(id)).toBe(2511);
    expect((await getDraft(db, id))?.erpNumber).toBe(2511);
  });

  it("readOrderNumber: reads once, returns the number as soon as it exists, null before; offline or a failed read returns the stored value", async () => {
    const id = await send();
    statuses = async () => [number(null)];
    const mgr = mk();
    await pushOnly(mgr);
    expect(await mgr.readOrderNumber?.(id)).toBeNull();
    statuses = async () => [number(3030)];
    expect(await mgr.readOrderNumber?.(id)).toBe(3030);
    statuses = async () => {
      throw fail("network");
    };
    expect(await mgr.readOrderNumber?.(id)).toBe(3030);
    expect(await mgr.readOrderNumber?.("nope")).toBeNull();
  });

  it("a source without the status capability ends as sending (the server has it)", async () => {
    const id = await send();
    const source = makeSource();
    const { fetchOrderStatuses: _drop, ...rest } = source;
    void _drop;
    expect(await mk({ source: rest as ReferenceSource }).confirmOrder?.(id, { sleep: fakeSleep().sleep })).toEqual({ kind: "sending" });
  });
});

/* ---------------------------------------------------------------- ERP stage download */

describe("refreshOrderErpStatuses: stage", () => {
  const stage = (over: Partial<DraftErpStage> = {}): DraftErpStage => ({
    stage: "financeiro",
    label: "Em análise financeira",
    pendingSector: "financeiro",
    nunota: 100,
    invoiceNumber: null,
    updatedAt: "2026-11-20T11:00:00.000Z",
    checkedAt: "2026-11-20T11:59:00.000Z",
    readError: null,
    ...over,
  });
  const st = (orderId: string, over: Partial<OrderErpStatus> = {}): OrderErpStatus => ({ orderId, erpNumber: 100, code: 2, label: "L", invoiceNumber: null, checkedAt: null, ...over });
  const hold = async (remoteId: string, owner = OWNER, customerCode = 10): Promise<string> => {
    const id = await saveOrderDraft(db, env, input({ ownerAccountId: owner, customerCode, customerName: `C${customerCode}` }));
    await db.execute("DELETE FROM outbox WHERE draft_local_id = ?", [id]);
    await db.execute("UPDATE local_order_draft SET remote_id = ?, status = 'synced' WHERE local_id = ?", [remoteId, id]);
    return id;
  };
  const refresh = (fetchOrderStatuses: ReferenceSource["fetchOrderStatuses"]) => refreshOrderErpStatuses(db, env, { fetchOrderStatuses }, OWNER);

  it("writes the stage the server sent (code column + the rest as json) and reads it back as the draft's last known stage", async () => {
    const id = await hold("o-1");
    await refresh(async () => [st("o-1", { stage: stage() })]);
    expect((await getDraft(db, id))?.erpStage).toEqual(stage());
    const raw = await db.query<{ erp_stage: string }>("SELECT erp_stage FROM local_order_draft WHERE local_id = ?", [id]);
    expect(raw[0]?.erp_stage).toBe("financeiro");
  });

  it("a response WITHOUT a stage (old server) or with null keeps the last known one, while the status itself is updated", async () => {
    const id = await hold("o-1");
    await refresh(async () => [st("o-1", { stage: stage() })]);
    await refresh(async () => [st("o-1", { code: 5, label: "Faturado" })]);
    await refresh(async () => [st("o-1", { stage: null })]);
    expect((await getDraft(db, id))?.erpStage).toEqual(stage());
    expect((await getOrderErpStatuses(db, ["o-1"]))[0]).toMatchObject({ code: 2 });
  });

  it("a newer stage replaces the older one", async () => {
    const id = await hold("o-1");
    await refresh(async () => [st("o-1", { stage: stage() })]);
    await refresh(async () => [st("o-1", { stage: stage({ stage: "faturado", label: "Faturado", pendingSector: null, invoiceNumber: 9 }) })]);
    expect((await getDraft(db, id))?.erpStage).toMatchObject({ stage: "faturado", invoiceNumber: 9, pendingSector: null });
  });

  it("an order that leaves the scope loses its status AND stage; the others keep theirs", async () => {
    const a = await hold("o-1");
    const b = await hold("o-2", OWNER, 11);
    await refresh(async () => [st("o-1", { stage: stage() }), st("o-2", { stage: stage() })]);
    await refresh(async () => [st("o-1", { stage: stage({ stage: "faturado" }) })]);
    expect((await getDraft(db, b))?.erpStage).toBeNull();
    expect(await getOrderErpStatuses(db, ["o-2"])).toEqual([]);
    expect((await getDraft(db, a))?.erpStage?.stage).toBe("faturado");
  });

  it("an answer for an id that was not asked is ignored", async () => {
    await hold("o-1");
    const stranger = await hold("o-x", "other-account", 12);
    await refresh(async () => [st("o-1"), st("o-x", { stage: stage() })]);
    expect((await getDraft(db, stranger))?.erpStage).toBeNull();
    expect(await getOrderErpStatuses(db, ["o-x"])).toEqual([]);
  });

  it("a failed chunk deletes nothing: earlier chunks are kept, the failing one keeps its previous status and stage", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 130; i += 1) ids.push(await hold(`o-${String(i).padStart(3, "0")}`, OWNER, 1000 + i));
    await refresh(async (asked) => asked.map((x) => st(x, { stage: stage({ label: "antigo" }) })));
    let call = 0;
    await expect(
      refresh(async (asked) => {
        call += 1;
        if (call === 2) throw fail("server", undefined, 503);
        return asked.map((x) => st(x, { stage: stage({ label: "novo" }) }));
      }),
    ).rejects.toBeInstanceOf(TransportError);
    expect((await getDraft(db, ids[0] as string))?.erpStage?.label).toBe("novo"); // first chunk of 100 was written
    expect((await getDraft(db, ids[129] as string))?.erpStage?.label).toBe("antigo"); // second chunk untouched, not deleted
    expect(await getOrderErpStatuses(db, ["o-129"])).toHaveLength(1);
  });

  it("refreshOne (confirm poll) writes the stage too and leaves it alone when absent", async () => {
    const id = await hold("o-1");
    statuses = async () => [st("o-1", { stage: stage() })];
    const mgr = mk();
    void mgr;
    const { refreshOneOrderErpStatus } = await import("../src/index");
    await refreshOneOrderErpStatus(db, env, { fetchOrderStatuses: async () => [st("o-1", { stage: stage() })] }, OWNER, "o-1");
    await refreshOneOrderErpStatus(db, env, { fetchOrderStatuses: async () => [st("o-1")] }, OWNER, "o-1");
    expect((await getDraft(db, id))?.erpStage).toEqual(stage());
    expect(await refreshOneOrderErpStatus(db, env, { fetchOrderStatuses: async () => [] }, OWNER, "o-1")).toBeNull();
  });

  it("stores no cost or margin fields (P-20): the stage keys are exactly the documented ones", async () => {
    const id = await hold("o-1");
    await refresh(async () => [st("o-1", { stage: stage() })]);
    expect(Object.keys((await getDraft(db, id))?.erpStage ?? {}).sort()).toEqual(["checkedAt", "invoiceNumber", "label", "nunota", "pendingSector", "readError", "stage", "updatedAt"]);
  });
});

describe("sales query: stage filter and counts", () => {
  const sentWith = async (remoteId: string, stage: string | null, customerCode: number): Promise<string> => {
    const id = await saveOrderDraft(db, env, input({ customerCode, customerName: `Cliente ${customerCode}` }));
    await db.execute("DELETE FROM outbox WHERE draft_local_id = ?", [id]);
    await db.execute("UPDATE local_order_draft SET remote_id = ?, status = 'synced', send_state = 'submitted', erp_stage = ?, erp_stage_json = ? WHERE local_id = ?", [
      remoteId,
      stage,
      stage === null ? null : JSON.stringify({ label: stage, pendingSector: null, nunota: null, invoiceNumber: null, updatedAt: "2026-11-20T10:00:00.000Z", checkedAt: null, readError: null }),
      id,
    ]);
    return id;
  };

  it("filters sent orders by any of the stage codes; counts per group follow the same filter", async () => {
    const a = await sentWith("o-1", "financeiro", 1);
    await sentWith("o-2", "faturado", 2);
    const c = await sentWith("o-3", "comercial", 3);
    await sentWith("o-4", null, 4);
    const unsent = await saveOrderDraft(db, env, input({ customerCode: 5, customerName: "Nao enviado" }));
    const dataset = REAL;
    const only = await queryDrafts(db, { ownerAccountId: OWNER, dataset, group: "sent", erpStages: ["financeiro", "comercial"] }, { limit: 50, offset: 0 });
    expect(only.rows.map((r) => r.localId).sort()).toEqual([a, c].sort());
    expect(only.total).toBe(2);
    expect(only.rows.every((r) => r.erpStage !== null)).toBe(true);
    // the unsent group is never narrowed by a stage (it has none)
    const unsentRows = await queryDrafts(db, { ownerAccountId: OWNER, dataset, group: "unsent", erpStages: ["financeiro"] }, { limit: 50, offset: 0 });
    expect(unsentRows.rows.map((r) => r.localId)).toEqual([unsent]);
    expect(await countDraftsByGroup(db, { ownerAccountId: OWNER, dataset, erpStages: ["financeiro", "comercial"] })).toEqual({ unsent: 1, sent: 2 });
    expect(await countDraftsByGroup(db, { ownerAccountId: OWNER, dataset })).toEqual({ unsent: 1, sent: 4 });
    // an empty stage list is no filter
    expect((await queryDrafts(db, { ownerAccountId: OWNER, dataset, group: "sent", erpStages: [] }, { limit: 50, offset: 0 })).total).toBe(4);
  });

  it("another account's orders never appear under a stage filter", async () => {
    await sentWith("o-1", "financeiro", 1);
    const other = await saveOrderDraft(db, env, input({ ownerAccountId: "other", customerCode: 9, customerName: "Y" }));
    await db.execute("UPDATE local_order_draft SET status = 'synced', erp_stage = 'financeiro', erp_stage_json = '{}' WHERE local_id = ?", [other]);
    const rows = await queryDrafts(db, { ownerAccountId: OWNER, dataset: REAL, group: "sent", erpStages: ["financeiro"] }, { limit: 50, offset: 0 });
    expect(rows.total).toBe(1);
  });
});

/* ---------------------------------------------------------------- cancel */

describe("SyncManager.cancel", () => {
  const cust = (name: string) => [{ code: 1, name }] as unknown as Awaited<ReturnType<ReferenceSource["fetchCustomers"]>>;
  const baseName = async (): Promise<string[]> => (await db.query<{ name: string }>("SELECT name FROM cache_customer ORDER BY code")).map((r) => r.name);

  const withFirstSyncDone = async () => {
    const first = mk({ source: makeSource({ fetchCustomers: async () => cust("Antigo") }) });
    const s = await first.sync("manual");
    expect(s.lastSyncedAt).not.toBeNull();
    t += 3600_000;
    return s.lastSyncedAt;
  };

  it("before the save: the previous base and lastSyncedAt stay, no error, steps null, phase idle", async () => {
    const previous = await withFirstSyncDone();
    let mgr!: SyncManager;
    mgr = mk({
      source: makeSource({
        fetchCustomers: async () => {
          mgr.cancel?.();
          return cust("Novo");
        },
      }),
    });
    const status = await mgr.sync("manual");
    expect(status).toMatchObject({ phase: "idle", failure: null, lastError: null, steps: null, lastSyncedAt: previous });
    expect(await baseName()).toEqual(["Antigo"]);
    expect(unexpected).toEqual([]);
    expect(mgr.getStatus().steps).toBeNull();
  });

  it("the next run after a cancel is not cancelled", async () => {
    let mgr!: SyncManager;
    let cancelNext = true;
    mgr = mk({
      source: makeSource({
        fetchCustomers: async () => {
          if (cancelNext) mgr.cancel?.();
          return cust("Novo");
        },
      }),
    });
    expect((await mgr.sync("manual")).steps).toBeNull();
    cancelNext = false;
    const second = await mgr.sync("manual");
    expect(second.steps).not.toBeNull();
    expect(second.lastSyncedAt).not.toBeNull();
    expect(await baseName()).toEqual(["Novo"]);
  });

  it("with no run in flight it is a no-op (does not cancel the next run)", async () => {
    const mgr = mk({ source: makeSource({ fetchCustomers: async () => cust("Novo") }) });
    mgr.cancel?.();
    const status = await mgr.sync("manual");
    expect(status.lastSyncedAt).not.toBeNull();
    expect(await baseName()).toEqual(["Novo"]);
  });

  it("during a push-only run it is ignored (only a full sync is cancellable)", async () => {
    await send();
    let mgr!: SyncManager;
    const hook: OrderTransport = {
      createOrder: async (k, r) => {
        mgr.cancel?.();
        return server.createOrder(k, r);
      },
      replaceOrder: server.replaceOrder.bind(server),
      getOrder: server.getOrder.bind(server),
      submitOrder: server.submitOrder.bind(server),
    };
    mgr = mk({ transport: hook });
    await mgr.sync("manual", { pull: false });
    expect(server.submitCalls).toEqual(["order-1"]);
    const next = await mgr.sync("manual");
    expect(next.lastSyncedAt).not.toBeNull();
  });

  it("checkpoint after the push: cancelled while the orders were being sent; they stay sent, nothing is downloaded or asked of the server", async () => {
    const id = await send();
    let mgr!: SyncManager;
    let refreshed = 0;
    const hook: OrderTransport = {
      createOrder: async (k, r) => {
        mgr.cancel?.();
        return server.createOrder(k, r);
      },
      replaceOrder: server.replaceOrder.bind(server),
      getOrder: server.getOrder.bind(server),
      submitOrder: server.submitOrder.bind(server),
    };
    mgr = mk({
      transport: hook,
      source: makeSource({
        refreshOnDemand: async () => {
          refreshed += 1;
          return { failed: false, failedSteps: [] };
        },
      }),
    });
    const status = await mgr.sync("manual");
    expect(status).toMatchObject({ phase: "idle", failure: null, steps: null, lastSyncedAt: null });
    expect(refreshed).toBe(0);
    expect(log).not.toContain("pull");
    expect((await getDraft(db, id))?.sendState).toBe("submitted");
  });

  it("checkpoint during the server refresh poll: progress callback after cancel stops the run before any download", async () => {
    let mgr!: SyncManager;
    mgr = mk({
      source: makeSource({
        refreshOnDemand: async (onProgress) => {
          mgr.cancel?.();
          onProgress({ label: "Lendo o Sankhya", percent: 10 });
          return { failed: false, failedSteps: [] };
        },
      }),
    });
    const status = await mgr.sync("manual");
    expect(status).toMatchObject({ phase: "idle", failure: null, lastError: null, steps: null, lastSyncedAt: null });
    expect(log).not.toContain("pull");
  });

  it("checkpoint on a pull event: a cancel raised while products download stops before the save", async () => {
    await withFirstSyncDone();
    let mgr!: SyncManager;
    mgr = mk({
      source: makeSource({
        fetchCustomers: async () => cust("Novo"),
        fetchProducts: async () => {
          mgr.cancel?.();
          return [];
        },
      }),
    });
    const status = await mgr.sync("manual");
    expect(status.steps).toBeNull();
    expect(await baseName()).toEqual(["Antigo"]);
  });

  it("after the save started it is ignored: the run finishes and the new base is in", async () => {
    let mgr!: SyncManager;
    mgr = mk({
      source: makeSource({
        fetchCustomers: async () => cust("Novo"),
        fetchOrderStatuses: async () => {
          mgr.cancel?.(); // the save already happened
          return [];
        },
      }),
    });
    await db.execute("INSERT INTO local_order_draft (local_id, owner_account_id, client_request_id, customer_code, customer_name, status, created_at, updated_at, dataset_environment, dataset_id, eligibility, remote_id) VALUES ('l1', ?, 'k1', 1, 'C', 'synced', ?, ?, 'production', 'mirror-real-001', 'eligible', 'o-1')", [OWNER, new Date(t).toISOString(), new Date(t).toISOString()]);
    const status = await mgr.sync("manual");
    expect(status.steps).not.toBeNull();
    expect(status.steps?.find((s) => s.id === "save")?.state).toBe("done");
    expect(status.lastSyncedAt).not.toBeNull();
    expect(status.phase).toBe("idle");
    expect(await baseName()).toEqual(["Novo"]);
  });
});

/* ---------------------------------------------------------------- orders step */

describe("orders step in the full sync", () => {
  const hold = async () => {
    const id = await saveOrderDraft(db, env, input());
    await db.execute("DELETE FROM outbox WHERE draft_local_id = ?", [id]);
    await db.execute("UPDATE local_order_draft SET remote_id = 'o-1', status = 'synced' WHERE local_id = ?", [id]);
    return id;
  };
  const stamp: DraftErpStage = { stage: "financeiro", label: "L", pendingSector: null, nunota: 1, invoiceNumber: null, updatedAt: "2026-11-20T10:00:00.000Z", checkedAt: null, readError: null };

  it("a non-auth failure keeps the last known status and stage; the run is clean and lastSyncedAt moves", async () => {
    const id = await hold();
    statuses = async () => [{ orderId: "o-1", erpNumber: 1, code: 1, label: "x", invoiceNumber: null, checkedAt: null, stage: stamp }];
    await mk().sync("manual");
    t += 1000;
    statuses = async () => {
      throw fail("server", undefined, 503);
    };
    const status = await mk().sync("manual");
    expect(status).toMatchObject({ phase: "idle", failure: null });
    expect(status.lastSyncedAt).toBe(new Date(t).toISOString());
    expect(status.steps?.find((s) => s.id === "orders")).toMatchObject({ state: "done", note: "mantida a última situação" });
    expect((await getDraft(db, id))?.erpStage).toEqual(stamp);
    expect(await getOrderErpStatuses(db, ["o-1"])).toHaveLength(1);
  });

  it("a network failure there is also not an error of the run", async () => {
    await hold();
    statuses = async () => {
      throw fail("network");
    };
    expect((await mk().sync("manual")).failure).toBeNull();
  });

  it("a 401 there is an auth error: the run needs a new login and is not marked as a success", async () => {
    await hold();
    statuses = async () => {
      throw fail("auth", undefined, 401);
    };
    const status = await mk().sync("manual");
    expect(status).toMatchObject({ phase: "auth_required", failure: "auth" });
    expect(status.lastSyncedAt).toBeNull();
  });
});
