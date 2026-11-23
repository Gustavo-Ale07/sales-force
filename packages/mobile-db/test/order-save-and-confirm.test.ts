import { describe, expect, it } from "vitest";
import { DraftNotEditableError, getDraft, isConfirmedLocked, migrations, runMigrations, saveOrderDraft, type OfflineEnv, type SqlDatabase } from "../src/index";
import { confirm, REAL } from "./helpers";
import { openNodeDatabase } from "./node-sqlite-connection";

const OWNER = "acct-1";
let seq = 0;
const env: OfflineEnv = { now: () => new Date("2026-11-23T12:00:00.000Z"), newId: () => `id-${String(++seq).padStart(4, "0")}` };

async function open(): Promise<SqlDatabase> {
  const db = openNodeDatabase();
  await runMigrations(db, migrations);
  await confirm(db);
  return db;
}

const order = (extra: Record<string, unknown> = {}) => ({
  ownerAccountId: OWNER,
  customerCode: 1,
  customerName: "Ana",
  negotiationTypeCode: null,
  notes: null,
  items: [{ productCode: 1, description: "P", unit: "UN", quantity: "1", discountPercent: "0", priceJson: "{}", groupCode: null, groupName: null }],
  loadedDataset: REAL,
  ...extra,
});

describe("Salvar e sair / Confirmar", () => {
  it("Salvar e sair (save without sendRequested) never writes a send request, even on repeated saves", async () => {
    const db = await open();
    const id = await saveOrderDraft(db, env, order());
    await saveOrderDraft(db, env, order({ localId: id, notes: "x" }));
    expect(await getDraft(db, id)).toMatchObject({ sendState: null, sendRequestedAt: null });
    expect(isConfirmedLocked((await getDraft(db, id))!)).toBe(false);
  });

  it("Confirmar blocks editing: a confirmed order waiting for delivery refuses edits, but repeating Confirmar is idempotent", async () => {
    const db = await open();
    const id = await saveOrderDraft(db, env, order({ sendRequested: true }));
    expect(isConfirmedLocked((await getDraft(db, id))!)).toBe(true);
    await expect(saveOrderDraft(db, env, order({ localId: id, notes: "x" }))).rejects.toBeInstanceOf(DraftNotEditableError);
    await saveOrderDraft(db, env, order({ localId: id, sendRequested: true }));
    expect((await getDraft(db, id))?.sendState).toBe("requested");
  });

  it("'Precisa de correção' (refused with a definitive code) unlocks the order for editing", async () => {
    const db = await open();
    const id = await saveOrderDraft(db, env, order({ sendRequested: true }));
    await db.execute("UPDATE local_order_draft SET send_state = 'refused', send_code = 'customer_without_seller', send_error = 'x' WHERE local_id = ?", [id]);
    expect(isConfirmedLocked((await getDraft(db, id))!)).toBe(false);
    await saveOrderDraft(db, env, order({ localId: id, notes: "corrigido" }));
    expect(await getDraft(db, id)).toMatchObject({ sendState: null, notes: "corrigido" });
  });
});
