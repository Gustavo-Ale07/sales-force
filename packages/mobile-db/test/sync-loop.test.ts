import { beforeEach, describe, expect, it } from "vitest";
import {
  createSyncManager,
  getDraft,
  listOutbox,
  migrations,
  runMigrations,
  saveOrderDraft,
  TransportError,
  type OfflineEnv,
  type OrderCommandPayload,
  type OrderTransport,
  type ReferenceSource,
  type RemoteOrder,
  type SaveDraftInput,
  type SqlDatabase,
  type SyncManager,
  type SyncStatus,
  countDraftsByGroup,
  discardRecovery,
  getRecovery,
  listDrafts,
  queryDrafts,
} from "../src/index";
import { confirm, REAL } from "./helpers";
import { openNodeDatabase } from "./node-sqlite-connection";

const OWNER = "acct-1";
const NO_SELLER = 5020;

function makeEnv(): OfflineEnv & { advance(ms: number): void } {
  let t = Date.parse("2026-11-23T16:21:00.000Z");
  let n = 0;
  return {
    now: () => new Date(t),
    newId: () => `id-${String(++n).padStart(4, "0")}`,
    advance: (ms) => {
      t += ms;
    },
  };
}

/** The server refuses a customer without a seller, exactly like `POST /orders` (customer_ineligible, reason customer_without_seller). */
class RefusingServer implements OrderTransport {
  posts = 0;
  async createOrder(): Promise<RemoteOrder> {
    this.posts += 1;
    throw new TransportError("customer_ineligible", "Cliente sem vendedor", 422, "customer_without_seller");
  }
  async replaceOrder(): Promise<RemoteOrder> {
    throw new TransportError("validation", "x");
  }
  async submitOrder(): Promise<never> {
    throw new TransportError("server", "submit not expected", 500);
  }
  async getOrder(): Promise<RemoteOrder> {
    throw new TransportError("not_found", "x", 404);
  }
}

const source: ReferenceSource = {
  fetchDatasetIdentity: async () => REAL,
  fetchCustomers: async () => [],
  fetchProducts: async () => [],
  fetchEntryConfiguration: async () => null,
};

const draftInput = (extra: Partial<SaveDraftInput> = {}): SaveDraftInput => ({
  ownerAccountId: OWNER,
  customerCode: NO_SELLER,
  customerName: "1 2 3 COMERCIO DE UTILIDADES",
  negotiationTypeCode: null,
  notes: null,
  loadedDataset: REAL,
  items: [{ productCode: 9, description: "P", unit: "UN", quantity: "1", discountPercent: "0", priceJson: JSON.stringify({ state: "priced", unitPrice: "26.05" }), groupCode: 1, groupName: "G" }],
  ...extra,
});

let db: SqlDatabase;
let env: ReturnType<typeof makeEnv>;
let server: RefusingServer;
let manager: SyncManager;
let statuses: SyncStatus[];

/**
 * What `useSyncStatus` does with the manager: new local work while online (pending > 0 and idle) triggers a push; a 60 s timer and the
 * foreground also push. `rounds` bounds the simulation so a loop shows up as a count, not a hang.
 */
async function driveLikeTheApp(rounds: number): Promise<number> {
  let runs = 0;
  for (let i = 0; i < rounds; i += 1) {
    const status = manager.getStatus();
    if (status.pending > 0 && status.phase === "idle") {
      runs += 1;
      await manager.sync("after_save", { pull: false });
    } else {
      break;
    }
  }
  return runs;
}

beforeEach(async () => {
  db = openNodeDatabase();
  await runMigrations(db, migrations);
  await confirm(db);
  env = makeEnv();
  server = new RefusingServer();
  manager = createSyncManager({ db, env, transport: server, source, ownerAccountId: OWNER, internetState: () => "online" });
  statuses = [];
  manager.subscribe((s) => statuses.push(s));
});

describe("customer without seller (owner bug 2026-11-23 16:21)", () => {
  it("an order being built and never saved sends nothing, counts nothing and leaves no record in the list", async () => {
    // The editor only protects against a forced close: no saved order, no command, no counter.
    await manager.refresh();
    const runs = await driveLikeTheApp(20);
    expect(runs).toBe(0);
    expect(server.posts).toBe(0);
    expect(manager.getStatus()).toMatchObject({ pending: 0, needsAttention: 0, awaitingOrders: 0 });
  });

  it("a saved order whose server copy is refused stays 'Salvo no aparelho': one attempt, no loop, no counters, no error", async () => {
    const id = await saveOrderDraft(db, env, draftInput());
    await manager.refresh();
    await driveLikeTheApp(20);
    await manager.sync("timer", { pull: false });
    env.advance(120_000);
    await manager.sync("timer", { pull: false });
    await manager.sync("foreground", { pull: false });
    expect(server.posts).toBeLessThanOrEqual(1);
    const draft = await getDraft(db, id);
    expect(draft).toMatchObject({ status: "pending_sync", lastError: null, sendState: null });
    expect(manager.getStatus()).toMatchObject({ phase: "idle", pending: 0, needsAttention: 0, awaitingOrders: 0, failure: null, lastError: null });
    expect(manager.getStatus().attention ?? []).toEqual([]);
    expect((await listOutbox(db, id)).length).toBeGreaterThan(0);
  });

  it("stable rendering: after the first run the published status never changes again, whatever the number of runs", async () => {
    await saveOrderDraft(db, env, draftInput());
    await manager.refresh();
    await driveLikeTheApp(5);
    statuses.length = 0;
    for (let i = 0; i < 5; i += 1) {
      env.advance(61_000);
      await manager.sync("timer", { pull: false });
    }
    const counters = statuses.filter((s) => s.phase === "idle").map((s) => JSON.stringify({ p: s.pending, n: s.needsAttention, a: s.awaitingOrders, e: s.lastError, f: s.failure }));
    expect(new Set(counters).size).toBeLessThanOrEqual(1);
    expect(server.posts).toBeLessThanOrEqual(1);
  });
});

describe("recovery record (autosave of an order still being built)", () => {
  it("is invisible: not listed, not counted, no command, never sent", async () => {
    const id = await saveOrderDraft(db, env, draftInput({ recovery: true }));
    await manager.refresh();
    expect(await listDrafts(db, OWNER)).toEqual([]);
    expect((await queryDrafts(db, { ownerAccountId: OWNER, group: "unsent" }, { limit: 20, offset: 0 })).rows).toEqual([]);
    expect((await queryDrafts(db, { ownerAccountId: OWNER, group: "unsent", dataset: REAL }, { limit: 20, offset: 0 })).total).toBe(0);
    expect(await countDraftsByGroup(db, { ownerAccountId: OWNER })).toEqual({ unsent: 0, sent: 0 });
    expect(await listOutbox(db, id)).toEqual([]);
    await manager.sync("timer", { pull: false });
    await manager.sync("foreground", { pull: false });
    expect(server.posts).toBe(0);
    expect(manager.getStatus()).toMatchObject({ pending: 0, needsAttention: 0, awaitingOrders: 0 });
    expect((await getRecovery(db, OWNER))?.localId).toBe(id);
  });

  it("autosave updates the same record in place; 'Salvar e sair' turns it into a saved order with its command", async () => {
    const id = await saveOrderDraft(db, env, draftInput({ recovery: true }));
    const again = await saveOrderDraft(db, env, draftInput({ recovery: true, localId: id, notes: "obs" }));
    expect(again).toBe(id);
    expect((await getRecovery(db, OWNER))?.notes).toBe("obs");
    const saved = await saveOrderDraft(db, env, draftInput({ localId: id, notes: "obs" }));
    expect(saved).toBe(id);
    expect(await getRecovery(db, OWNER)).toBeNull();
    expect((await listDrafts(db, OWNER)).map((d) => d.localId)).toEqual([id]);
    expect((await listOutbox(db, id)).map((op) => op.type)).toEqual(["order.create"]);
    expect(await getDraft(db, id)).toMatchObject({ kind: "saved", status: "pending_sync" });
  });

  it("a saved order is never turned back into a recovery record", async () => {
    const id = await saveOrderDraft(db, env, draftInput());
    await expect(saveOrderDraft(db, env, draftInput({ recovery: true, localId: id }))).rejects.toThrow();
  });

  it("discard deletes only the recovery record, never a saved order", async () => {
    const saved = await saveOrderDraft(db, env, draftInput());
    await saveOrderDraft(db, env, draftInput({ recovery: true }));
    await discardRecovery(db, OWNER);
    expect(await getRecovery(db, OWNER)).toBeNull();
    expect((await getDraft(db, saved))?.kind).toBe("saved");
  });
});

describe("what counts as 'aguardando envio'", () => {
  it("only confirmed orders count; the server copy of a saved-only order does not", async () => {
    await saveOrderDraft(db, env, draftInput({ customerCode: 77 }));
    await manager.refresh();
    expect(manager.getStatus()).toMatchObject({ pending: 0, awaitingOrders: 0, needsAttention: 0 });
    await saveOrderDraft(db, env, draftInput({ customerCode: 78, sendRequested: true }));
    await manager.refresh();
    expect(manager.getStatus().awaitingOrders).toBe(1);
    expect(manager.getStatus().pending).toBeGreaterThan(0);
  });

  it("a confirmed order the server refuses (no seller): one attempt, 'needs attention', no loop, stable status", async () => {
    const id = await saveOrderDraft(db, env, draftInput({ sendRequested: true }));
    await manager.refresh();
    await manager.sync("after_save", { pull: false });
    const first = JSON.stringify([manager.getStatus().pending, manager.getStatus().needsAttention, manager.getStatus().awaitingOrders]);
    for (let i = 0; i < 4; i += 1) {
      env.advance(61_000);
      await manager.sync("timer", { pull: false });
    }
    expect(server.posts).toBe(1);
    expect(JSON.stringify([manager.getStatus().pending, manager.getStatus().needsAttention, manager.getStatus().awaitingOrders])).toBe(first);
    expect(await getDraft(db, id)).toMatchObject({ status: "sync_error", sendState: "requested" });
    expect(manager.getStatus().needsAttention).toBeGreaterThan(0);
  });
});

describe("migration 14 cleanup (orders left in the wrong state on devices)", () => {
  async function insertDraft(old: SqlDatabase, id: string, extra: { status: string; sendState?: string; remoteId?: string; error?: string }): Promise<void> {
    await old.execute(
      `INSERT INTO local_order_draft (local_id, owner_account_id, client_request_id, customer_code, customer_name, status, last_error, remote_id, remote_version, send_state, created_at, updated_at, dataset_environment, dataset_id, eligibility)
       VALUES (?, ?, ?, 5020, 'C', ?, ?, ?, ?, ?, '2026-11-23T16:00:00.000Z', '2026-11-23T16:00:00.000Z', ?, ?, 'eligible')`,
      [id, OWNER, `k-${id}`, extra.status, extra.error ?? null, extra.remoteId ?? null, extra.remoteId === undefined ? null : 1, extra.sendState ?? null, REAL.environment, REAL.datasetId],
    );
    await old.execute(
      `INSERT INTO outbox (local_id, operation_id, idempotency_key, type, payload, state, attempts, last_error, draft_local_id, created_at, updated_at, dataset_environment, dataset_id, eligibility)
       VALUES (?, ?, ?, 'order.create', '{"request":{"customerCode":5020,"negotiationTypeCode":null,"notes":null,"items":[]},"prices":[]}', ?, 1, ?, ?, '2026-11-23T16:00:00.000Z', '2026-11-23T16:00:00.000Z', ?, ?, 'eligible')`,
      [`o-${id}`, `op-${id}`, `k-${id}`, extra.status === "sync_error" ? "rejected" : "pending", extra.error ?? null, id, REAL.environment, REAL.datasetId],
    );
  }

  it("a never-confirmed order stuck in sync_error becomes a recovery record (kept); everything saved on purpose is untouched", async () => {
    const old = openNodeDatabase();
    await runMigrations(old, migrations.slice(0, 13));
    await insertDraft(old, "stuck", { status: "sync_error", error: "Este cliente não tem vendedor." });
    await insertDraft(old, "confirmed", { status: "sync_error", sendState: "requested", error: "Este cliente não tem vendedor." });
    await insertDraft(old, "onserver", { status: "sync_error", remoteId: "srv-1", error: "x" });
    await insertDraft(old, "plain", { status: "pending_sync" });
    await runMigrations(old, migrations);
    const kinds = Object.fromEntries((await old.query<{ local_id: string; kind: string; status: string }>("SELECT local_id, kind, status FROM local_order_draft")).map((r) => [r.local_id, `${r.kind}/${r.status}`]));
    expect(kinds).toEqual({ stuck: "recovery/local_only", confirmed: "saved/sync_error", onserver: "saved/sync_error", plain: "saved/pending_sync" });
    // nothing was deleted: the recovery record still holds its order; only its refused command is gone
    expect(await old.query("SELECT local_id FROM outbox WHERE draft_local_id = 'stuck'")).toEqual([]);
    expect((await old.query("SELECT local_id FROM outbox")).length).toBe(3);
    expect((await getRecovery(old, OWNER))?.localId).toBe("stuck");
    expect((await listDrafts(old, OWNER)).map((d) => d.localId).sort()).toEqual(["confirmed", "onserver", "plain"]);
  });
});
