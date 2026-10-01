import { beforeEach, describe, expect, it } from "vitest";
import { countDraftsByGroup, migrations, queryDrafts, runMigrations, saveOrderDraft, SENT_STATUSES, UNSENT_STATUSES, type DraftStatus, type OfflineEnv, type SqlDatabase } from "../src/index";
import { REAL } from "./helpers";
import { confirm } from "./helpers";
import { openNodeDatabase } from "./node-sqlite-connection";

const OWNER = "acct-1";
let db: SqlDatabase;
let clock: number;
let seq: number;
const env: OfflineEnv = { now: () => new Date(clock), newId: () => `id-${String(++seq).padStart(4, "0")}` };

async function draft(customerCode: number, customerName: string, status: DraftStatus, extra: { at?: string; owner?: string; remoteNumber?: number } = {}): Promise<string> {
  clock = Date.parse(extra.at ?? "2026-09-30T12:00:00.000Z");
  const id = await saveOrderDraft(db, env, {
    ownerAccountId: extra.owner ?? OWNER,
    customerCode,
    customerName,
    negotiationTypeCode: null,
    notes: null,
    items: [{ productCode: 1, description: "P", unit: "UN", quantity: "1", discountPercent: "0", priceJson: "{}", groupCode: null, groupName: null }],
    loadedDataset: REAL,
  });
  await db.execute("UPDATE local_order_draft SET status = ?, remote_draft_number = ?, remote_id = ? WHERE local_id = ?", [
    status,
    extra.remoteNumber ?? null,
    extra.remoteNumber === undefined ? null : `r-${id}`,
    id,
  ]);
  return id;
}

beforeEach(async () => {
  db = openNodeDatabase();
  await runMigrations(db, migrations);
  await confirm(db);
  clock = Date.parse("2026-09-30T12:00:00.000Z");
  seq = 0;
});

const page = { limit: 25, offset: 0 };

describe("queryDrafts — grouping", () => {
  it("puts every non-synced status in 'unsent' and only synced in 'sent'", () => {
    expect([...UNSENT_STATUSES].sort()).toEqual(["conflict", "local_only", "needs_review", "pending_sync", "sync_error", "syncing"]);
    expect([...SENT_STATUSES]).toEqual(["synced"]);
  });

  it("filters by group and counts both groups for the same other filters", async () => {
    await draft(1, "Ana", "pending_sync");
    await draft(2, "Bia", "sync_error");
    await draft(3, "Caio", "conflict");
    await draft(4, "Dora", "synced", { remoteNumber: 10 });
    const unsent = await queryDrafts(db, { ownerAccountId: OWNER, group: "unsent" }, page);
    expect(unsent.total).toBe(3);
    expect(unsent.rows.map((r) => r.customerName).sort()).toEqual(["Ana", "Bia", "Caio"]);
    const sent = await queryDrafts(db, { ownerAccountId: OWNER, group: "sent" }, page);
    expect(sent.rows.map((r) => r.customerName)).toEqual(["Dora"]);
    expect(await countDraftsByGroup(db, { ownerAccountId: OWNER })).toEqual({ unsent: 3, sent: 1 });
    expect(await countDraftsByGroup(db, { ownerAccountId: OWNER, customerCode: 4 })).toEqual({ unsent: 0, sent: 1 });
  });

  it("never returns another account's drafts", async () => {
    await draft(1, "Ana", "pending_sync", { owner: "acct-2" });
    expect((await queryDrafts(db, { ownerAccountId: OWNER }, page)).total).toBe(0);
  });
});

describe("queryDrafts — filters", () => {
  it("filters by exact status, customer and created-at range (local creation date)", async () => {
    await draft(1, "Ana", "pending_sync", { at: "2026-09-01T10:00:00.000Z" });
    await draft(1, "Ana", "sync_error", { at: "2026-09-20T10:00:00.000Z" });
    await draft(2, "Bia", "sync_error", { at: "2026-09-29T10:00:00.000Z" });
    expect((await queryDrafts(db, { ownerAccountId: OWNER, statuses: ["sync_error"] }, page)).total).toBe(2);
    expect((await queryDrafts(db, { ownerAccountId: OWNER, customerCode: 1 }, page)).total).toBe(2);
    const ranged = await queryDrafts(db, { ownerAccountId: OWNER, createdFrom: "2026-09-15T00:00:00.000Z", createdBefore: "2026-09-29T00:00:00.000Z" }, page);
    expect(ranged.rows.map((r) => r.customerName)).toEqual(["Ana"]);
  });

  it("combines filters (group + status + customer)", async () => {
    await draft(1, "Ana", "sync_error");
    await draft(1, "Ana", "pending_sync");
    await draft(2, "Bia", "sync_error");
    const r = await queryDrafts(db, { ownerAccountId: OWNER, group: "unsent", statuses: ["sync_error"], customerCode: 1 }, page);
    expect(r.total).toBe(1);
  });
});

describe("queryDrafts — text search", () => {
  it("matches customer name (case-insensitive), customer code and Force order number; never fuzzy", async () => {
    await draft(101, "Padaria Central", "synced", { remoteNumber: 42 });
    await draft(202, "Mercado Sul", "pending_sync");
    const by = async (text: string) => (await queryDrafts(db, { ownerAccountId: OWNER, text }, page)).rows.map((r) => r.customerName);
    expect(await by("padaria")).toEqual(["Padaria Central"]);
    expect(await by("202")).toEqual(["Mercado Sul"]);
    expect(await by("42")).toEqual(["Padaria Central"]);
    expect(await by("zzz")).toEqual([]);
    expect(await by("Pa%")).toEqual([]);
  });

  it("matches a local id prefix", async () => {
    const id = await draft(1, "Ana", "pending_sync");
    expect((await queryDrafts(db, { ownerAccountId: OWNER, text: id.slice(0, 6) }, page)).total).toBe(1);
  });
});

describe("queryDrafts — paging and order", () => {
  it("orders by last update (newest first) and pages without losing rows", async () => {
    for (let i = 1; i <= 7; i += 1) await draft(i, `Cliente ${i}`, "pending_sync", { at: `2026-09-${String(10 + i).padStart(2, "0")}T10:00:00.000Z` });
    const first = await queryDrafts(db, { ownerAccountId: OWNER }, { limit: 3, offset: 0 });
    const second = await queryDrafts(db, { ownerAccountId: OWNER }, { limit: 3, offset: 3 });
    const third = await queryDrafts(db, { ownerAccountId: OWNER }, { limit: 3, offset: 6 });
    expect(first.total).toBe(7);
    expect([...first.rows, ...second.rows, ...third.rows].map((r) => r.customerCode)).toEqual([7, 6, 5, 4, 3, 2, 1]);
  });
});
