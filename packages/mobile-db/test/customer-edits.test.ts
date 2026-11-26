import { beforeEach, describe, expect, it } from "vitest";
import {
  CustomerEditError,
  countCustomerEdits,
  createSyncManager,
  enqueueCustomerEdit,
  listCustomerEdits,
  migrations,
  pushCustomerEdits,
  resolveCustomerEditConflict,
  runMigrations,
  saveOrderDraft,
  TransportError,
  type CustomerEditChanges,
  type CustomerEditTransport,
  type OfflineEnv,
  type OrderTransport,
  type ReferenceSource,
  type RemoteOrder,
  type SqlDatabase,
} from "../src/index";
import { confirm, REAL } from "./helpers";
import { openNodeDatabase } from "./node-sqlite-connection";

const OWNER = "acct-1";
let n = 0;
const env: OfflineEnv = { now: () => new Date("2026-11-26T12:00:00.000Z"), newId: () => `edit-${String(++n).padStart(4, "0")}` };

const log: string[] = [];
type Outcome = "ok" | TransportError;

class Erp implements CustomerEditTransport {
  script: Outcome[] = ["ok"];
  calls: { key: string; code: number; changes: CustomerEditChanges; base: string | null }[] = [];
  async updateCustomer(key: string, code: number, changes: CustomerEditChanges, base: string | null): Promise<void> {
    log.push("edit");
    this.calls.push({ key, code, changes, base });
    const next = this.script.length > 1 ? this.script.shift() : this.script[0];
    if (next instanceof TransportError) throw next;
  }
}

class Orders implements OrderTransport {
  async createOrder(_key: string, req: { customerCode: number }): Promise<RemoteOrder> {
    log.push("order");
    return { id: "r", version: 1, draftNumber: 1, customerCode: req.customerCode, customerName: "C", negotiationTypeCode: null, topCode: null, carrierCode: null, freightType: null, notes: null, estimatedTotal: "0.00", items: [] };
  }
  async replaceOrder(): Promise<never> {
    throw new TransportError("network", "x");
  }
  async submitOrder(): Promise<never> {
    throw new TransportError("server", "x", 500);
  }
  async getOrder(): Promise<never> {
    throw new TransportError("not_found", "x");
  }
}

const conflict = () => new TransportError("edit_conflict", "Cliente alterado no Sankhya.", 409, "customer_edit_conflict", { phone: "11888887777", email: "novo@x.com", contactVersion: "v2" });

let db: SqlDatabase;
let erp: Erp;
const push = () => pushCustomerEdits(db, env, erp, OWNER, { currentDataset: REAL });
const enqueue = (changes: CustomerEditChanges, code = 55, base: string | null = "v1") =>
  enqueueCustomerEdit(db, env, { ownerAccountId: OWNER, customerCode: code, customerName: "Padaria", changes, baseContactVersion: base });

beforeEach(async () => {
  log.length = 0;
  db = openNodeDatabase();
  await runMigrations(db, migrations);
  await confirm(db);
  erp = new Erp();
});

describe("offline edit of an existing customer", () => {
  it("is stored with the typed changes and sent once, with its request id and the base version; the row goes away", async () => {
    const edit = await enqueue({ phone: "11999990000" });
    expect(edit).toMatchObject({ state: "queued", customerCode: 55, baseContactVersion: "v1" });
    const result = await push();
    expect(result).toMatchObject({ attempted: 1, sent: 1, stoppedBy: "idle" });
    expect(erp.calls).toEqual([{ key: edit.clientRequestId, code: 55, changes: { phone: "11999990000" }, base: "v1" }]);
    expect(await listCustomerEdits(db, OWNER, REAL)).toEqual([]);
  });

  it("two edits of the same customer before sending become one request (later values win, first base stays)", async () => {
    await enqueue({ phone: "11999990000", notes: "a" }, 55, "v1");
    await enqueue({ notes: "b" }, 55, "v9");
    await push();
    expect(erp.calls).toHaveLength(1);
    expect(erp.calls[0]).toMatchObject({ changes: { phone: "11999990000", notes: "b" }, base: "v1" });
  });

  it("a dead network keeps the edit queued and the next run reuses the SAME request id (no duplicate)", async () => {
    const edit = await enqueue({ email: "a@b.com" });
    erp.script = [new TransportError("network", "x"), "ok"];
    expect(await push()).toMatchObject({ sent: 0, stoppedBy: "offline" });
    expect((await listCustomerEdits(db, OWNER, REAL))[0]).toMatchObject({ state: "queued", attempts: 1 });
    expect(await push()).toMatchObject({ sent: 1 });
    expect(erp.calls.map((call) => call.key)).toEqual([edit.clientRequestId, edit.clientRequestId]);
    expect(await push()).toMatchObject({ attempted: 0 });
    expect(erp.calls).toHaveLength(2);
  });

  it("a local (not yet sent) customer cannot be edited", async () => {
    await expect(enqueue({ phone: "1" }, -3)).rejects.toBeInstanceOf(CustomerEditError);
  });

  it("a refusal is kept with its text, counted as needing attention and never resent", async () => {
    await enqueue({ email: "a@b.com" });
    erp.script = [new TransportError("validation", "E-mail inválido.", 422)];
    expect(await push()).toMatchObject({ rejected: 1 });
    expect(await countCustomerEdits(db, OWNER, REAL)).toEqual({ pending: 0, needsAttention: 1 });
    await push();
    expect(erp.calls).toHaveLength(1);
  });
});

describe("edit conflict (the customer changed in Sankhya meanwhile)", () => {
  it("keeps both versions and waits for the seller; nothing is sent again by itself", async () => {
    await enqueue({ phone: "11999990000" });
    erp.script = [conflict()];
    expect(await push()).toMatchObject({ conflicts: 1, stoppedBy: "idle" });
    const [row] = await listCustomerEdits(db, OWNER, REAL);
    expect(row).toMatchObject({ state: "conflict", changes: { phone: "11999990000" }, serverVersion: { phone: "11888887777", email: "novo@x.com", contactVersion: "v2" } });
    await push();
    expect(erp.calls).toHaveLength(1);
    expect(await countCustomerEdits(db, OWNER, REAL)).toEqual({ pending: 0, needsAttention: 1 });
  });

  it("keeping mine sends it again over the server's current version", async () => {
    const edit = await enqueue({ phone: "11999990000" });
    erp.script = [conflict(), "ok"];
    await push();
    await resolveCustomerEditConflict(db, env, OWNER, edit.clientRequestId, "mine");
    expect(await push()).toMatchObject({ sent: 1 });
    expect(erp.calls[1]).toMatchObject({ key: edit.clientRequestId, base: "v2", changes: { phone: "11999990000" } });
    expect(await listCustomerEdits(db, OWNER, REAL)).toEqual([]);
  });

  it("keeping Sankhya's discards the local edit and sends nothing", async () => {
    const edit = await enqueue({ phone: "11999990000" });
    erp.script = [conflict()];
    await push();
    await resolveCustomerEditConflict(db, env, OWNER, edit.clientRequestId, "theirs");
    expect(await listCustomerEdits(db, OWNER, REAL)).toEqual([]);
    await push();
    expect(erp.calls).toHaveLength(1);
  });
});

describe("queue order in a sync: edits before orders", () => {
  it("sends the customer edit first and the order after", async () => {
    await enqueue({ phone: "11999990000" });
    await saveOrderDraft(db, env, { ownerAccountId: OWNER, customerCode: 55, customerName: "Padaria", negotiationTypeCode: null, notes: null, loadedDataset: REAL, items: [] });
    const source: ReferenceSource = { fetchCustomers: async () => [], fetchProducts: async () => [], fetchEntryConfiguration: async () => null, fetchDatasetIdentity: async () => REAL };
    const status = await createSyncManager({ db, env, transport: new Orders(), customerEditTransport: erp, source, ownerAccountId: OWNER }).sync("manual");
    expect(status.phase).toBe("idle");
    expect(log).toEqual(["edit", "order"]);
  });
});
