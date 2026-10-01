import { beforeEach, describe, expect, it } from "vitest";
import {
  DraftDiscardError,
  countQuarantinedDrafts,
  discardQuarantinedDraft,
  getDraft,
  getQuarantinedDraft,
  listOperationalDrafts,
  listOutbox,
  listQuarantinedDrafts,
  migrations,
  pushOutbox,
  runMigrations,
  saveOrderDraft,
  TransportError,
  type DatasetIdentity,
  type OfflineEnv,
  type OrderCommandPayload,
  type OrderTransport,
  type RemoteOrder,
  type SqlDatabase,
  type SqlExecutor,
} from "../src/index";
import { FAKE, REAL, confirm } from "./helpers";
import { openNodeDatabase } from "./node-sqlite-connection";

const A = "acct-A";
const B = "acct-B";

let db: SqlDatabase;
let clock: number;
let seq: number;
const env: OfflineEnv = { now: () => new Date(clock), newId: () => `id-${String(++seq).padStart(4, "0")}` };

class SpyTransport implements OrderTransport {
  calls: string[] = [];
  async createOrder(key: string, _request: OrderCommandPayload["request"], _dataset: DatasetIdentity): Promise<RemoteOrder> {
    this.calls.push(`POST ${key}`);
    throw new TransportError("network", "sem rede");
  }
  async replaceOrder(id: string): Promise<RemoteOrder> {
    this.calls.push(`PUT ${id}`);
    throw new TransportError("network", "sem rede");
  }
  async getOrder(id: string): Promise<RemoteOrder> {
    this.calls.push(`GET ${id}`);
    throw new TransportError("network", "sem rede");
  }
}

const item = { productCode: 1, description: "P", unit: "UN", quantity: "1", discountPercent: "0", priceJson: JSON.stringify({ state: "priced", unitPrice: "10.00" }), groupCode: null, groupName: null };

/** A row exactly as the pre-v3 app wrote it (no identity columns): draft + one create command, with `itemCount` items. */
async function insertLegacy(
  target: SqlExecutor,
  owner: string,
  suffix: string,
  opts: { state?: string; attempts?: number; remoteId?: string | null; itemCount?: number } = {},
): Promise<string> {
  const id = `legacy-${suffix}`;
  await target.execute(
    `INSERT INTO local_order_draft (local_id, owner_account_id, client_request_id, customer_code, customer_name, status, remote_id, created_at, updated_at)
     VALUES (?, ?, ?, 5, 'Cliente Antigo', 'pending_sync', ?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
    [id, owner, `key-${suffix}`, opts.remoteId ?? null],
  );
  for (let position = 1; position <= (opts.itemCount ?? 1); position += 1) {
    await target.execute(
      `INSERT INTO local_order_item (draft_local_id, position, product_code, description, unit, quantity, discount_percent, price_json)
       VALUES (?, ?, ?, 'P', 'UN', '1', '0', '{}')`,
      [id, position, position],
    );
  }
  await target.execute(
    `INSERT INTO outbox (local_id, operation_id, idempotency_key, type, payload, state, attempts, draft_local_id, created_at, updated_at)
     VALUES (?, ?, ?, 'order.create', ?, ?, ?, ?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
    [
      `op-${suffix}`,
      `opid-${suffix}`,
      `key-${suffix}`,
      JSON.stringify({ request: { customerCode: 5, negotiationTypeCode: null, notes: null, items: [] }, prices: [] }),
      opts.state ?? "pending",
      opts.attempts ?? 0,
      id,
    ],
  );
  return id;
}

const operationalInput = (owner = A) => ({ ownerAccountId: owner, customerCode: 9, customerName: "Cliente Novo", negotiationTypeCode: null, notes: null, items: [item], loadedDataset: REAL });
const quarantineRun = (spy: SpyTransport) => pushOutbox(db, env, spy, A, { respectBackoff: false, currentDataset: REAL });

beforeEach(async () => {
  db = openNodeDatabase();
  await runMigrations(db, migrations);
  clock = Date.parse("2026-09-30T12:00:00.000Z");
  seq = 0;
});

describe("quarantine listing (read-only)", () => {
  it("lists a legacy draft after the push guard quarantined it, with customer, date, item count and reason", async () => {
    await confirm(db);
    const id = await insertLegacy(db, A, "1", { itemCount: 3 });
    await quarantineRun(new SpyTransport());
    const [row] = await listQuarantinedDrafts(db, A);
    expect(row).toMatchObject({ canDiscard: true, reason: "legacy_local" });
    expect(row?.draft).toMatchObject({ localId: id, customerName: "Cliente Antigo", itemCount: 3, createdAt: "2026-09-01T00:00:00.000Z", eligibility: "legacy_local" });
    expect(await countQuarantinedDrafts(db, A)).toBe(1);
  });

  it("lists a legacy draft BEFORE any push ran (offline-only device), so the attention counter never points at an empty section", async () => {
    await confirm(db);
    await insertLegacy(db, A, "1");
    expect((await listQuarantinedDrafts(db, A)).map((q) => q.draft.localId)).toEqual(["legacy-1"]);
    expect((await listQuarantinedDrafts(db, A))[0]?.reason).toBe("legacy_local");
  });

  it("lists drafts of another dataset with their own reason", async () => {
    await confirm(db, FAKE);
    await saveOrderDraft(db, env, { ...operationalInput(), loadedDataset: FAKE });
    await confirm(db, REAL);
    await quarantineRun(new SpyTransport());
    const [row] = await listQuarantinedDrafts(db, A);
    expect(row?.reason).toBe("dataset_mismatch");
  });

  it("never lists operational drafts, other owners' drafts, or legacy orders already delivered", async () => {
    await confirm(db);
    await saveOrderDraft(db, env, operationalInput());
    await insertLegacy(db, B, "other");
    await insertLegacy(db, A, "delivered", { state: "accepted", remoteId: "order-9", attempts: 1 });
    expect(await listQuarantinedDrafts(db, A)).toEqual([]);
    expect(await countQuarantinedDrafts(db, A)).toBe(0);
  });

  it("stays out of the operational lists", async () => {
    await confirm(db);
    await insertLegacy(db, A, "1");
    await quarantineRun(new SpyTransport());
    expect(await listOperationalDrafts(db, A, REAL)).toEqual([]);
  });

  it("listing and opening never change a row, never re-queue a command and never reach the transport", async () => {
    await confirm(db);
    await insertLegacy(db, A, "1");
    const spy = new SpyTransport();
    await quarantineRun(spy);
    const before = JSON.stringify([await listOutbox(db), await getDraft(db, "legacy-1")]);
    await listQuarantinedDrafts(db, A);
    await getQuarantinedDraft(db, A, "legacy-1");
    await quarantineRun(spy);
    expect(JSON.stringify([await listOutbox(db), await getDraft(db, "legacy-1")])).toBe(before);
    expect(spy.calls).toEqual([]);
    expect((await listOutbox(db))[0]).toMatchObject({ state: "needs_review", eligibility: "legacy_local" });
  });

  it("opens one quarantined draft with its items; refuses operational or foreign ones", async () => {
    await confirm(db);
    await insertLegacy(db, A, "1", { itemCount: 2 });
    const operational = await saveOrderDraft(db, env, operationalInput());
    const opened = await getQuarantinedDraft(db, A, "legacy-1");
    expect(opened?.items).toHaveLength(2);
    expect(opened?.record.draft.localId).toBe("legacy-1");
    expect(await getQuarantinedDraft(db, A, operational)).toBeNull();
    expect(await getQuarantinedDraft(db, B, "legacy-1")).toBeNull();
    expect(await getQuarantinedDraft(db, A, "missing")).toBeNull();
  });

  it("flags drafts that cannot be discarded (a command was attempted)", async () => {
    await confirm(db);
    await insertLegacy(db, A, "sent", { state: "needs_review", attempts: 1 });
    const [row] = await listQuarantinedDrafts(db, A);
    expect(row?.canDiscard).toBe(false);
  });
});

describe("discardQuarantinedDraft (explicit, local only)", () => {
  it("deletes draft, items and commands of a never-sent quarantined draft, and nothing else", async () => {
    await confirm(db);
    await insertLegacy(db, A, "1");
    await insertLegacy(db, A, "2");
    const spy = new SpyTransport();
    await quarantineRun(spy);
    await discardQuarantinedDraft(db, A, "legacy-1");
    expect(await getDraft(db, "legacy-1")).toBeNull();
    expect((await listOutbox(db)).map((op) => op.draftLocalId)).toEqual(["legacy-2"]);
    expect((await listQuarantinedDrafts(db, A)).map((q) => q.draft.localId)).toEqual(["legacy-2"]);
    expect(spy.calls).toEqual([]);
  });

  it("allows a draft whose only attempted command was definitively rejected", async () => {
    await confirm(db);
    await insertLegacy(db, A, "1", { state: "rejected", attempts: 1 });
    await db.execute("UPDATE local_order_draft SET eligibility = 'legacy_local' WHERE local_id = 'legacy-1'");
    await discardQuarantinedDraft(db, A, "legacy-1");
    expect(await getDraft(db, "legacy-1")).toBeNull();
  });

  it("refuses a draft with a remote id", async () => {
    await confirm(db);
    await insertLegacy(db, A, "1", { remoteId: "order-1", state: "needs_review" });
    await expect(discardQuarantinedDraft(db, A, "legacy-1")).rejects.toBeInstanceOf(DraftDiscardError);
    expect(await getDraft(db, "legacy-1")).not.toBeNull();
  });

  it("refuses a draft with an attempted (non-rejected) command", async () => {
    await confirm(db);
    await insertLegacy(db, A, "1", { state: "needs_review", attempts: 2 });
    await expect(discardQuarantinedDraft(db, A, "legacy-1")).rejects.toBeInstanceOf(DraftDiscardError);
    expect(await getDraft(db, "legacy-1")).not.toBeNull();
    expect(await listOutbox(db)).toHaveLength(1);
  });

  it("refuses an operational draft (that is not quarantine) and leaves another owner's draft alone", async () => {
    await confirm(db);
    const operational = await saveOrderDraft(db, env, operationalInput());
    await expect(discardQuarantinedDraft(db, A, operational)).rejects.toBeInstanceOf(DraftDiscardError);
    await insertLegacy(db, B, "other");
    await discardQuarantinedDraft(db, A, "legacy-other");
    expect(await getDraft(db, "legacy-other")).not.toBeNull();
    expect(await getDraft(db, operational)).not.toBeNull();
  });
});
