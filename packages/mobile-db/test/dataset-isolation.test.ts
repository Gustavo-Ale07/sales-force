import { beforeEach, describe, expect, it } from "vitest";
import {
  DatasetChangedError,
  DatasetIdentityError,
  DatasetUnavailableError,
  DraftNotEditableError,
  acknowledgePriceReview,
  classifyEligibility,
  countOutbox,
  createSyncManager,
  getDraft,
  inspectLocalState,
  isCacheReady,
  listDrafts,
  listOperationalDrafts,
  listOutbox,
  migrations,
  pullReferenceData,
  pushOutbox,
  queryDrafts,
  readCacheDataset,
  readExpectedDataset,
  recoverInterrupted,
  replaceCustomers,
  replaceProducts,
  runMigrations,
  TransportError,
  saveOrderDraft,
  searchCustomers,
  searchProducts,
  setMeta,
  type DatasetIdentity,
  type OfflineEnv,
  type OrderCommandPayload,
  type OrderTransport,
  type ReferenceSource,
  type RemoteOrder,
  type SqlDatabase,
  type SqlExecutor,
} from "../src/index";
import { FAKE, REAL, SANDBOX, confirm } from "./helpers";
import { openNodeDatabase } from "./node-sqlite-connection";

const A = "acct-A";
const B = "acct-B";

let db: SqlDatabase;
let clock: number;
let seq: number;
const env: OfflineEnv = { now: () => new Date(clock), newId: () => `id-${String(++seq).padStart(4, "0")}` };

/** Spy transport: records every call; the test asserts on `calls`. */
class SpyTransport implements OrderTransport {
  calls: string[] = [];
  /** The `expectedDataset` carried by each request, in order. */
  sentDatasets: DatasetIdentity[] = [];
  /** Answer the next request(s) with this error instead of an order. */
  failWith: TransportError | null = null;
  async createOrder(key: string, request: OrderCommandPayload["request"], expectedDataset: DatasetIdentity): Promise<RemoteOrder> {
    this.calls.push(`POST ${key}`);
    this.sentDatasets.push(expectedDataset);
    if (this.failWith !== null) throw this.failWith;
    return {
      id: "order-1",
      version: 1,
      draftNumber: 1,
      customerCode: request.customerCode,
      customerName: "x",
      negotiationTypeCode: null,
      notes: null,
      estimatedTotal: "0.00",
      items: request.items.map((i) => ({
        productCode: i.productCode,
        productDescription: "p",
        unit: "UN",
        quantity: i.quantity,
        unitListPrice: "10.00",
        priceState: "priced" as const,
        priceTableCode: 1,
        priceVersionId: 1,
        discountPercent: "0",
      })),
    };
  }
  async replaceOrder(id: string, _expectedVersion: number, request: OrderCommandPayload["request"], expectedDataset: DatasetIdentity): Promise<RemoteOrder> {
    this.calls.push(`PUT ${id}`);
    this.sentDatasets.push(expectedDataset);
    if (this.failWith !== null) throw this.failWith;
    const created = await this.createOrder("replace", request, expectedDataset);
    this.calls.pop();
    this.sentDatasets.pop();
    return { ...created, id };
  }
  async getOrder(): Promise<RemoteOrder> {
    this.calls.push("GET");
    throw new Error("not used");
  }
}

const sourceOf = (identity: () => DatasetIdentity | null, onData?: () => void): ReferenceSource => ({
  fetchCustomers: async () => {
    onData?.();
    return [{ code: 1, name: "Cliente Um" }];
  },
  fetchProducts: async () => [{ code: 10, description: "Produto Dez", groupCode: 2 }],
  fetchEntryConfiguration: async () => ({}),
  fetchDatasetIdentity: async () => identity(),
});

const item = { productCode: 1, description: "P", unit: "UN", quantity: "1", discountPercent: "0", priceJson: JSON.stringify({ state: "priced", unitPrice: "10.00" }), groupCode: null, groupName: null };
const draftInput = (owner = A, loaded: DatasetIdentity | null = REAL) => ({ ownerAccountId: owner, customerCode: 5, customerName: "Cliente", negotiationTypeCode: null, notes: null, items: [item], loadedDataset: loaded });

/** A row exactly as the pre-v3 app wrote it (no identity columns): draft + pending create. */
async function insertLegacy(target: SqlExecutor, owner: string, suffix: string, state = "pending"): Promise<string> {
  const id = `legacy-${suffix}`;
  await target.execute(
    `INSERT INTO local_order_draft (local_id, owner_account_id, client_request_id, customer_code, customer_name, status, created_at, updated_at)
     VALUES (?, ?, ?, 5, 'Cliente', 'pending_sync', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
    [id, owner, `key-${suffix}`],
  );
  await target.execute(
    `INSERT INTO local_order_item (draft_local_id, position, product_code, description, unit, quantity, discount_percent, price_json)
     VALUES (?, 1, 1, 'P', 'UN', '1', '0', '{}')`,
    [id],
  );
  await target.execute(
    `INSERT INTO outbox (local_id, operation_id, idempotency_key, type, payload, state, attempts, draft_local_id, created_at, updated_at)
     VALUES (?, ?, ?, 'order.create', ?, ?, 0, ?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
    [`op-${suffix}`, `opid-${suffix}`, `key-${suffix}`, JSON.stringify({ request: { customerCode: 5, negotiationTypeCode: null, notes: null, items: [{ productCode: 1, quantity: "1" }] }, prices: [] }), state, id],
  );
  return id;
}

beforeEach(async () => {
  db = openNodeDatabase();
  await runMigrations(db, migrations);
  clock = Date.parse("2026-09-30T12:00:00.000Z");
  seq = 0;
});

describe("reference cache validity (owner + environment + dataset id)", () => {
  it("A: same user and same dataset => cache is valid", async () => {
    await pullReferenceData(db, env, sourceOf(() => REAL), A);
    expect(await isCacheReady(db, A)).toBe(true);
    expect(await readCacheDataset(db)).toEqual(REAL);
    expect(await readExpectedDataset(db)).toEqual(REAL);
  });

  it("B: another user => cache is invalid", async () => {
    await pullReferenceData(db, env, sourceOf(() => REAL), A);
    expect(await isCacheReady(db, B)).toBe(false);
  });

  it("C: sandbox -> production (same dataset id, other environment) => invalid", async () => {
    await pullReferenceData(db, env, sourceOf(() => SANDBOX), A);
    expect(await isCacheReady(db, A)).toBe(true);
    await confirm(db, REAL); // the server now declares production
    expect(await isCacheReady(db, A)).toBe(false);
  });

  it("D: fake dataset -> real dataset (same environment, other dataset id) => invalid", async () => {
    await pullReferenceData(db, env, sourceOf(() => FAKE), A);
    await confirm(db, REAL);
    expect(await isCacheReady(db, A)).toBe(false);
  });

  it("is not ready without any confirmed identity, after a server 'cannot tell', or for a pre-v3 cache", async () => {
    await pullReferenceData(db, env, sourceOf(() => REAL), A);
    await confirm(db, null); // online answer null => confirmation removed
    expect(await isCacheReady(db, A)).toBe(false);
    await confirm(db, REAL);
    expect(await isCacheReady(db, A)).toBe(true);
    await db.execute("DELETE FROM sync_metadata WHERE key LIKE 'cache.dataset_%'"); // cache written by an older app
    expect(await isCacheReady(db, A)).toBe(false);
  });

  it("offline: the last confirmed identity keeps a matching cache usable", async () => {
    await pullReferenceData(db, env, sourceOf(() => REAL), A);
    // no new confirmation happens while offline; the stored one is still the reference
    expect(await isCacheReady(db, A)).toBe(true);
  });

  it("null server identity aborts the pull, keeps the old cache and writes nothing", async () => {
    await pullReferenceData(db, env, sourceOf(() => REAL), A);
    await expect(pullReferenceData(db, env, sourceOf(() => null), B)).rejects.toBeInstanceOf(DatasetIdentityError);
    expect(await readCacheDataset(db)).toEqual(REAL);
    expect(await isCacheReady(db, A)).toBe(true);
    expect(await isCacheReady(db, B)).toBe(false);
  });

  it("an identity change in the middle of a pull aborts it", async () => {
    let current: DatasetIdentity = REAL;
    await expect(
      pullReferenceData(db, env, sourceOf(() => current, () => (current = FAKE)), A),
    ).rejects.toBeInstanceOf(DatasetIdentityError);
    expect(await readCacheDataset(db)).toBeNull();
    expect((await searchCustomers(db, { search: "", page: 1, pageSize: 10 })).total).toBe(0);
  });

  it("H: replaceCustomers fully replaces the previous rows", async () => {
    await db.transaction((tx) => replaceCustomers(tx, [{ code: 1, name: "Velho Um" }, { code: 2, name: "Velho Dois" }]));
    await db.transaction((tx) => replaceCustomers(tx, [{ code: 3, name: "Novo" }]));
    const page = await searchCustomers<{ code: number; name: string }>(db, { search: "", page: 1, pageSize: 10 });
    expect(page.items.map((c) => c.code)).toEqual([3]);
  });

  it("I: replaceProducts fully replaces the previous rows", async () => {
    await db.transaction((tx) => replaceProducts(tx, [{ code: 1, description: "Velho" }, { code: 2, description: "Velho 2" }]));
    await db.transaction((tx) => replaceProducts(tx, [{ code: 9, description: "Novo" }]));
    const page = await searchProducts<{ code: number; description: string }>(db, { search: "", page: 1, pageSize: 10 });
    expect(page.items.map((p) => p.code)).toEqual([9]);
  });
});

describe("migration v3", () => {
  it("keeps existing rows, deletes nothing and leaves them without identity (legacy_local)", async () => {
    const old = openNodeDatabase();
    await runMigrations(old, migrations.slice(0, 2));
    await insertLegacy(old, A, "1");
    await insertLegacy(old, A, "2", "needs_review");
    const report = await runMigrations(old, migrations);
    expect(report.applied).toEqual([3]);
    expect((await listDrafts(old, A)).map((d) => [d.dataset, d.eligibility])).toEqual([
      [null, "unchecked"],
      [null, "unchecked"],
    ]);
    const ops = await listOutbox(old);
    expect(ops).toHaveLength(2);
    expect(ops.every((op) => op.dataset === null && op.eligibility === "unchecked")).toBe(true);
    // the guard then classifies them as legacy and never sends them
    const spy = new SpyTransport();
    await pushOutbox(old, env, spy, A, { respectBackoff: false, currentDataset: REAL });
    expect(spy.calls).toEqual([]);
    expect((await listDrafts(old, A)).every((d) => d.eligibility === "legacy_local" && d.status === "needs_review")).toBe(true);
  });

  it("rejects an eligibility value outside the allowed set", async () => {
    await expect(db.execute("UPDATE outbox SET eligibility = 'whatever'")).resolves.toBeDefined(); // no rows yet
    await insertLegacy(db, A, "x");
    await expect(db.execute("UPDATE outbox SET eligibility = 'whatever'")).rejects.toThrow();
  });
});

describe("push guard", () => {
  it("re-reads the confirmed dataset before every command: a flip mid-run stops the run, the rest is not POSTed and stays retryable", async () => {
    await confirm(db, REAL);
    await saveOrderDraft(db, env, draftInput());
    await saveOrderDraft(db, env, draftInput());
    const spy = new SpyTransport();
    const original = spy.createOrder.bind(spy);
    spy.createOrder = async (key, request, dataset) => {
      const result = await original(key, request, dataset);
      await confirm(db, FAKE); // the confirmation changes after the first POST
      return result;
    };
    const result = await pushOutbox(db, env, spy, A, { respectBackoff: false, currentDataset: REAL });
    expect(spy.calls).toHaveLength(1);
    expect(result.stoppedBy).toBe("dataset_unconfirmed");
    const rest = (await listOutbox(db)).filter((op) => op.state === "pending");
    expect(rest).toHaveLength(1);
    expect(rest[0]).toMatchObject({ attempts: 0, dataset: REAL });
  });

  it("a confirmation that vanishes mid-run stops the run too", async () => {
    await confirm(db, REAL);
    await saveOrderDraft(db, env, draftInput());
    await saveOrderDraft(db, env, draftInput());
    const spy = new SpyTransport();
    const original = spy.createOrder.bind(spy);
    spy.createOrder = async (key, request, dataset) => {
      const result = await original(key, request, dataset);
      await confirm(db, null);
      return result;
    };
    const result = await pushOutbox(db, env, spy, A, { respectBackoff: false, currentDataset: REAL });
    expect(spy.calls).toHaveLength(1);
    expect(result.stoppedBy).toBe("dataset_unconfirmed");
  });

  it("E/F: a legacy draft and its outbox row never reach the transport, in this run or later ones", async () => {
    await confirm(db);
    const id = await insertLegacy(db, A, "1");
    const spy = new SpyTransport();
    const first = await pushOutbox(db, env, spy, A, { respectBackoff: false, currentDataset: REAL });
    expect(spy.calls).toEqual([]);
    expect(first).toMatchObject({ attempted: 0, accepted: 0, quarantined: 1 });
    const draft = await getDraft(db, id);
    expect(draft).toMatchObject({ status: "needs_review", eligibility: "legacy_local", lastError: expect.stringContaining("não será enviado") });
    const [op] = await listOutbox(db);
    expect(op).toMatchObject({ state: "needs_review", eligibility: "legacy_local", attempts: 0 });

    // later runs, recovery included, never resurrect it
    await recoverInterrupted(db, env);
    await pushOutbox(db, env, spy, A, { respectBackoff: false, currentDataset: REAL });
    await pushOutbox(db, env, spy, A, { respectBackoff: true, currentDataset: REAL });
    expect(spy.calls).toEqual([]);
    expect((await listOutbox(db))[0]).toMatchObject({ state: "needs_review", eligibility: "legacy_local" });
  });

  it("a legacy command interrupted while 'sending' is not resurrected as sendable", async () => {
    const id = await insertLegacy(db, A, "1", "sending");
    const spy = new SpyTransport();
    await recoverInterrupted(db, env); // legacy rows are 'unchecked': back to pending, but the guard stops them
    await pushOutbox(db, env, spy, A, { respectBackoff: false, currentDataset: REAL });
    expect(spy.calls).toEqual([]);
    expect((await getDraft(db, id))?.eligibility).toBe("legacy_local");
  });

  it("fake-dataset and other-environment commands are refused with the matching reason", async () => {
    await confirm(db, FAKE);
    const fakeId = await saveOrderDraft(db, env, draftInput(A, FAKE));
    await confirm(db, SANDBOX);
    const sandboxId = await saveOrderDraft(db, env, draftInput(A, SANDBOX));
    await confirm(db, REAL);
    const spy = new SpyTransport();
    const result = await pushOutbox(db, env, spy, A, { respectBackoff: false, currentDataset: REAL });
    expect(spy.calls).toEqual([]);
    expect(result.quarantined).toBe(2);
    expect((await getDraft(db, fakeId))?.eligibility).toBe("dataset_mismatch");
    expect((await getDraft(db, sandboxId))?.eligibility).toBe("environment_mismatch");
    expect((await getDraft(db, sandboxId))?.lastError).toBe("Pedido de outro conjunto de dados — não será enviado.");
  });

  it("G: a new draft stamped with the current identity syncs normally", async () => {
    await confirm(db);
    const id = await saveOrderDraft(db, env, draftInput());
    expect(await getDraft(db, id)).toMatchObject({ dataset: REAL, eligibility: "eligible" });
    expect((await listOutbox(db))[0]).toMatchObject({ dataset: REAL, eligibility: "eligible" });
    const spy = new SpyTransport();
    const result = await pushOutbox(db, env, spy, A, { respectBackoff: false, currentDataset: REAL });
    expect(spy.calls).toHaveLength(1);
    expect(result).toMatchObject({ accepted: 1, quarantined: 0 });
    expect((await getDraft(db, id))?.status).toBe("synced");
  });

  it("an unknown current identity sends nothing and keeps retryable commands pending", async () => {
    await confirm(db);
    const id = await saveOrderDraft(db, env, draftInput());
    const spy = new SpyTransport();
    for (const currentDataset of [null, undefined]) {
      const result = await pushOutbox(db, env, spy, A, { respectBackoff: false, ...(currentDataset === undefined ? {} : { currentDataset }) });
      expect(result.stoppedBy).toBe("dataset_unconfirmed");
    }
    expect(spy.calls).toEqual([]);
    expect((await listOutbox(db))[0]).toMatchObject({ state: "pending", attempts: 0 });
    expect((await getDraft(db, id))?.status).toBe("pending_sync");
  });

  it("another account's commands are never pushed by this account", async () => {
    await confirm(db);
    await saveOrderDraft(db, env, draftInput(A));
    const spy = new SpyTransport();
    await pushOutbox(db, env, spy, B, { respectBackoff: false, currentDataset: REAL });
    expect(spy.calls).toEqual([]);
  });

  it("classifyEligibility covers every verdict (owner first, then legacy, then environment, then dataset id)", () => {
    const base = { rowOwnerAccountId: A, currentOwnerAccountId: A, rowDataset: REAL, current: REAL };
    expect(classifyEligibility(base)).toBe("eligible");
    expect(classifyEligibility({ ...base, currentOwnerAccountId: B })).toBe("owner_mismatch");
    expect(classifyEligibility({ ...base, rowDataset: null })).toBe("legacy_local");
    expect(classifyEligibility({ ...base, current: null })).toBe("unconfirmed");
    expect(classifyEligibility({ ...base, rowDataset: SANDBOX })).toBe("environment_mismatch");
    expect(classifyEligibility({ ...base, rowDataset: FAKE })).toBe("dataset_mismatch");
  });

  it("a price review acknowledgement never deletes a quarantined command", async () => {
    const id = await insertLegacy(db, A, "1");
    await pushOutbox(db, env, new SpyTransport(), A, { respectBackoff: false, currentDataset: REAL });
    await db.execute("UPDATE local_order_draft SET price_review = '[]' WHERE local_id = ?", [id]);
    await acknowledgePriceReview(db, env, id);
    expect(await listOutbox(db)).toHaveLength(1);
    expect((await getDraft(db, id))?.status).toBe("needs_review");
  });
});

describe("creating and editing drafts", () => {
  it("rejects a save whose editor was loaded under another dataset than the one confirmed now; nothing is stamped", async () => {
    await confirm(db, REAL);
    const loadedUnder = REAL; // editor opened under A...
    await confirm(db, FAKE); // ...then the confirmation flips
    await expect(saveOrderDraft(db, env, draftInput(A, loadedUnder))).rejects.toBeInstanceOf(DatasetChangedError);
    expect(await listDrafts(db, A)).toEqual([]);
    expect(await listOutbox(db)).toEqual([]);
  });

  it("rejects a save without a loaded dataset", async () => {
    await confirm(db, REAL);
    await expect(saveOrderDraft(db, env, draftInput(A, null))).rejects.toBeInstanceOf(DatasetUnavailableError);
    expect(await listDrafts(db, A)).toEqual([]);
  });

  it("cannot create a draft when no dataset was ever confirmed; nothing is written", async () => {
    await expect(saveOrderDraft(db, env, draftInput())).rejects.toBeInstanceOf(DatasetUnavailableError);
    expect(await listDrafts(db, A)).toEqual([]);
    expect(await listOutbox(db)).toEqual([]);
  });

  it("a draft of another dataset or a legacy draft cannot be edited", async () => {
    await confirm(db, FAKE);
    const fakeId = await saveOrderDraft(db, env, draftInput(A, FAKE));
    const legacyId = await insertLegacy(db, A, "1");
    await confirm(db, REAL);
    await expect(saveOrderDraft(db, env, { ...draftInput(), localId: fakeId })).rejects.toBeInstanceOf(DraftNotEditableError);
    await expect(saveOrderDraft(db, env, { ...draftInput(), localId: legacyId })).rejects.toBeInstanceOf(DraftNotEditableError);
  });

  it("an edit keeps the draft's own identity on the new command", async () => {
    await confirm(db);
    const id = await saveOrderDraft(db, env, draftInput());
    await pushOutbox(db, env, new SpyTransport(), A, { respectBackoff: false, currentDataset: REAL });
    await saveOrderDraft(db, env, { ...draftInput(), localId: id });
    expect((await listOutbox(db)).at(-1)).toMatchObject({ type: "order.replace", dataset: REAL });
  });
});

describe("operational views and counters", () => {
  it("only drafts of the confirmed dataset are listed as operational; the rest are counted as needing attention", async () => {
    await confirm(db, FAKE);
    await saveOrderDraft(db, env, draftInput(A, FAKE));
    await insertLegacy(db, A, "1");
    await confirm(db, REAL);
    const real = await saveOrderDraft(db, env, draftInput());

    expect((await listOperationalDrafts(db, A, REAL)).map((d) => d.localId)).toEqual([real]);
    expect(await listOperationalDrafts(db, A, null)).toEqual([]);
    const rows = await queryDrafts(db, { ownerAccountId: A, dataset: REAL }, { limit: 10, offset: 0 });
    expect(rows.rows.map((d) => d.localId)).toEqual([real]);
    expect((await queryDrafts(db, { ownerAccountId: A, dataset: null }, { limit: 10, offset: 0 })).total).toBe(0);

    // before any guard ran: only the real command is pending; the other two are attention items, not pending
    expect(await countOutbox(db, A, REAL)).toEqual({ pending: 1, sending: 0, needsAttention: 2 });
    await pushOutbox(db, env, new SpyTransport(), A, { respectBackoff: false, currentDataset: REAL });
    expect(await countOutbox(db, A, REAL)).toEqual({ pending: 0, sending: 0, needsAttention: 2 });
  });

  it("J: another account signing in sees nothing of the previous account (drafts, cache, outbox counters)", async () => {
    await confirm(db);
    await pullReferenceData(db, env, sourceOf(() => REAL), A);
    await saveOrderDraft(db, env, draftInput(A));
    // sign-out wipes nothing; account B signs in on the same device
    expect(await listOperationalDrafts(db, B, REAL)).toEqual([]);
    expect((await queryDrafts(db, { ownerAccountId: B, dataset: REAL }, { limit: 10, offset: 0 })).total).toBe(0);
    expect(await countOutbox(db, B, REAL)).toEqual({ pending: 0, sending: 0, needsAttention: 0 });
    expect(await isCacheReady(db, B)).toBe(false);
    // and A gets its own back
    expect(await listOperationalDrafts(db, A, REAL)).toHaveLength(1);
    expect(await isCacheReady(db, A)).toBe(true);
  });
});

describe("sync manager with dataset confirmation", () => {
  it("a null server identity blocks the push and the pull (fail closed)", async () => {
    await confirm(db);
    await saveOrderDraft(db, env, draftInput());
    const spy = new SpyTransport();
    const manager = createSyncManager({ db, env, transport: spy, source: sourceOf(() => null), ownerAccountId: A });
    const status = await manager.sync("manual");
    expect(spy.calls).toEqual([]);
    expect(status.phase).toBe("error");
    expect(status.lastError).toMatch(/conjunto de dados/);
    expect(await readExpectedDataset(db)).toBeNull();
    expect(status.pending).toBe(1);
  });

  it("when the server switches dataset, old commands are quarantined, not sent, and the cache is replaced", async () => {
    await confirm(db, FAKE);
    await saveOrderDraft(db, env, draftInput(A, FAKE));
    const spy = new SpyTransport();
    const manager = createSyncManager({ db, env, transport: spy, source: sourceOf(() => REAL), ownerAccountId: A });
    const status = await manager.sync("manual");
    expect(spy.calls).toEqual([]);
    expect(status).toMatchObject({ phase: "idle", pending: 0, needsAttention: 1 });
    expect(await readCacheDataset(db)).toEqual(REAL);
    expect(await isCacheReady(db, A)).toBe(true);
  });

  it("syncs a current-dataset command normally", async () => {
    await confirm(db);
    await saveOrderDraft(db, env, draftInput());
    const spy = new SpyTransport();
    const manager = createSyncManager({ db, env, transport: spy, source: sourceOf(() => REAL), ownerAccountId: A });
    expect(await manager.sync("manual")).toMatchObject({ phase: "idle", pending: 0, needsAttention: 0 });
    expect(spy.calls).toHaveLength(1);
  });
});

describe("inspectLocalState", () => {
  /** Wraps the database and records every statement, so the test can assert it only reads. */
  function recording(target: SqlDatabase): { executor: SqlExecutor; sql: string[] } {
    const sql: string[] = [];
    const executor: SqlExecutor = {
      query: (text, params) => (sql.push(text), target.query(text, params)),
      execute: (text, params) => (sql.push(text), target.execute(text, params)),
    };
    return { executor, sql };
  }

  it("executes only SELECT/PRAGMA and changes nothing", async () => {
    await confirm(db, FAKE);
    await saveOrderDraft(db, env, draftInput(A, FAKE));
    await insertLegacy(db, A, "1");
    const before = JSON.stringify([await listDrafts(db, A), await listOutbox(db)]);
    const { executor, sql } = recording(db);
    await inspectLocalState(executor);
    expect(sql.length).toBeGreaterThan(0);
    expect(sql.every((statement) => /^\s*(SELECT|PRAGMA)\b/i.test(statement))).toBe(true);
    expect(JSON.stringify([await listDrafts(db, A), await listOutbox(db)])).toBe(before);
  });

  it("reports identity, classification and no secrets or personal text", async () => {
    await confirm(db, FAKE);
    await saveOrderDraft(db, env, { ...draftInput(A, FAKE), notes: "observação confidencial", customerName: "Nome Secreto Ltda" });
    await insertLegacy(db, A, "1");
    await confirm(db, REAL);
    await pullReferenceData(db, env, sourceOf(() => REAL), A);
    const real = await saveOrderDraft(db, env, draftInput());
    await setMeta(db, "session.last_account", JSON.stringify({ id: A, email: "vendedor@example.com", displayName: "Fulano" }), "2026-09-30T12:00:00.000Z");
    await db.execute("UPDATE outbox SET last_error = ? WHERE draft_local_id = ?", ["x".repeat(500), real]);

    const report = await inspectLocalState(db);
    const json = JSON.stringify(report);
    expect(json).not.toContain("vendedor@example.com");
    expect(json).not.toContain("Nome Secreto");
    expect(json).not.toContain("observação confidencial");
    expect(report.cache).toMatchObject({ customers: 1, products: 1, ownerAccountId: A, environment: "production", datasetId: REAL.datasetId });
    expect(report.expectedDataset).toEqual(REAL);
    expect(report.metadata.find((m) => m.key === "session.last_account")).toMatchObject({ value: null });
    expect(report.drafts.map((d) => d.classification).sort()).toEqual(["legacy_local", "mismatch", "operational"]);
    expect(report.drafts.find((d) => d.localId === real)).toMatchObject({ customerCode: 5, itemProductCodes: [1], datasetId: REAL.datasetId });
    expect(report.outbox.find((o) => o.draftLocalId === real)?.lastError).toHaveLength(120);
    expect(report.outbox.map((o) => o.classification).sort()).toEqual(["legacy_local", "mismatch", "operational"]);
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

describe("expectedDataset on the wire (server is the second barrier)", () => {
  it("create carries the identity stored on the draft/outbox row, and so does a later replace", async () => {
    await confirm(db, REAL);
    const id = await saveOrderDraft(db, env, draftInput(A, REAL));
    const spy = new SpyTransport();
    await pushOutbox(db, env, spy, A, { respectBackoff: false, currentDataset: REAL });
    await saveOrderDraft(db, env, { ...draftInput(A, REAL), localId: id });
    await pushOutbox(db, env, spy, A, { respectBackoff: false, currentDataset: REAL });
    expect(spy.calls.map((c) => c.split(" ")[0])).toEqual(["POST", "PUT"]);
    expect(spy.sentDatasets).toEqual([REAL, REAL]);
  });

  it("a draft stamped with another dataset than the confirmed one is never POSTed (not sent with the current identity either)", async () => {
    await confirm(db, FAKE);
    await saveOrderDraft(db, env, draftInput(A, FAKE));
    await confirm(db, REAL);
    const spy = new SpyTransport();
    await pushOutbox(db, env, spy, A, { respectBackoff: false, currentDataset: REAL });
    expect(spy.calls).toEqual([]);
    expect(spy.sentDatasets).toEqual([]);
  });

  it("a row without identity (legacy_local) is quarantined and nothing is sent", async () => {
    await confirm(db, REAL);
    await insertLegacy(db, A, "1");
    const spy = new SpyTransport();
    await pushOutbox(db, env, spy, A, { respectBackoff: false, currentDataset: REAL });
    expect(spy.sentDatasets).toEqual([]);
  });

  it("409 dataset_mismatch: the draft is quarantined, the run stops, later commands stay pending and nothing is retried", async () => {
    await confirm(db, REAL);
    const first = await saveOrderDraft(db, env, draftInput());
    const second = await saveOrderDraft(db, env, draftInput());
    const spy = new SpyTransport();
    spy.failWith = new TransportError("dataset_mismatch", "dataset_mismatch", 409);
    const result = await pushOutbox(db, env, spy, A, { respectBackoff: false, currentDataset: REAL });
    expect(result).toMatchObject({ attempted: 1, accepted: 0, failed: 1, stoppedBy: "dataset_mismatch", quarantined: 1 });
    expect(spy.calls).toHaveLength(1);
    const ops = await listOutbox(db);
    expect(ops.find((o) => o.draftLocalId === first)).toMatchObject({ state: "needs_review", eligibility: "dataset_mismatch", nextAttemptAt: null });
    expect(await getDraft(db, first)).toMatchObject({ status: "needs_review", eligibility: "dataset_mismatch", lastError: "Pedido de outro conjunto de dados — não será enviado." });
    expect(ops.find((o) => o.draftLocalId === second)).toMatchObject({ state: "pending", attempts: 0, eligibility: "eligible" });

    // next run: the quarantined command is never retried; the untouched one goes out normally
    spy.failWith = null;
    const again = await pushOutbox(db, env, spy, A, { respectBackoff: false, currentDataset: REAL });
    expect(again).toMatchObject({ attempted: 1, accepted: 1 });
    expect(spy.calls).toHaveLength(2);
    expect((await getDraft(db, first))?.eligibility).toBe("dataset_mismatch");
    expect((await listOutbox(db)).find((o) => o.draftLocalId === first)?.state).toBe("needs_review");
  });

  it("409 dataset_mismatch on a replace quarantines the draft as well", async () => {
    await confirm(db, REAL);
    const id = await saveOrderDraft(db, env, draftInput());
    const spy = new SpyTransport();
    await pushOutbox(db, env, spy, A, { respectBackoff: false, currentDataset: REAL });
    await saveOrderDraft(db, env, { ...draftInput(), localId: id });
    spy.failWith = new TransportError("dataset_mismatch", "dataset_mismatch", 409);
    const result = await pushOutbox(db, env, spy, A, { respectBackoff: false, currentDataset: REAL });
    expect(result.stoppedBy).toBe("dataset_mismatch");
    expect(await getDraft(db, id)).toMatchObject({ status: "needs_review", eligibility: "dataset_mismatch" });
  });
});
