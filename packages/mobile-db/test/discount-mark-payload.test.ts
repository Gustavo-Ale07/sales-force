import { describe, expect, it } from "vitest";
import {
  getDraft,
  listOutbox,
  migrations,
  pushOutbox,
  runMigrations,
  saveOrderDraft,
  type OfflineEnv,
  type OrderCommandPayload,
  type OrderTransport,
  type RemoteOrder,
  type SqlDatabase,
} from "../src/index";
import { confirm, REAL } from "./helpers";
import { openNodeDatabase } from "./node-sqlite-connection";

const OWNER = "acct-1";
let seq = 0;
const env: OfflineEnv = { now: () => new Date("2026-11-23T12:00:00.000Z"), newId: () => `mk-${String(++seq).padStart(4, "0")}` };

async function open(): Promise<SqlDatabase> {
  const db = openNodeDatabase();
  await runMigrations(db, migrations);
  await confirm(db);
  return db;
}

const line = { productCode: 4158, description: "P", unit: "UN", quantity: "1", discountPercent: "15", priceJson: JSON.stringify({ state: "priced", unitPrice: "10.00" }), groupCode: null, groupName: null };
const order = (extra: Record<string, unknown> = {}) => ({ ownerAccountId: OWNER, customerCode: 1, customerName: "Ana", negotiationTypeCode: null, notes: null, items: [line], loadedDataset: REAL, ...extra });

function remoteOf(request: OrderCommandPayload["request"], mark: boolean | undefined): RemoteOrder {
  return {
    id: "srv-1",
    version: 1,
    draftNumber: 1,
    customerCode: request.customerCode,
    customerName: "Ana",
    negotiationTypeCode: null,
    topCode: null,
    carrierCode: null,
    notes: null,
    ...(mark === undefined ? {} : { discountAboveLimitAccepted: mark }),
    estimatedTotal: "10.00",
    items: [{ productCode: 4158, productDescription: "P", unit: "UN", quantity: "1", unitListPrice: "10.00", priceState: "priced", priceTableCode: 1, priceVersionId: 1, discountPercent: "15" }],
  };
}

function transport(sent: OrderCommandPayload["request"][], mark: boolean | undefined): OrderTransport {
  return {
    createOrder: async (_key, request) => {
      sent.push(request);
      return remoteOf(request, mark);
    },
    replaceOrder: async (_id, _version, request) => {
      sent.push(request);
      return remoteOf(request, mark);
    },
    getOrder: async () => remoteOf({ customerCode: 1, negotiationTypeCode: null, notes: null, items: [] }, mark),
    submitOrder: async () => {
      throw new Error("submit is not part of this test");
    },
  };
}

describe("discountAboveLimitAccepted on order commands", () => {
  it("is omitted when the order was never marked (old payload shape)", async () => {
    const db = await open();
    const id = await saveOrderDraft(db, env, order());
    const [op] = await listOutbox(db, id);
    expect(op?.payload.request).not.toHaveProperty("discountAboveLimitAccepted");
  });

  it("travels in the queued create command and in the HTTP request of the push", async () => {
    const db = await open();
    const id = await saveOrderDraft(db, env, order({ discountOverLimitAccepted: true }));
    const [op] = await listOutbox(db, id);
    expect(op?.payload.request.discountAboveLimitAccepted).toBe(true);
    const sent: OrderCommandPayload["request"][] = [];
    await pushOutbox(db, env, transport(sent, true), OWNER, { respectBackoff: false, currentDataset: REAL });
    expect(sent[0]?.discountAboveLimitAccepted).toBe(true);
  });

  it("a later replace of a marked order keeps carrying the mark even when the edit does not repeat it", async () => {
    const db = await open();
    const id = await saveOrderDraft(db, env, order({ discountOverLimitAccepted: true }));
    const sent: OrderCommandPayload["request"][] = [];
    await pushOutbox(db, env, transport(sent, true), OWNER, { respectBackoff: false, currentDataset: REAL });
    await saveOrderDraft(db, env, order({ localId: id, notes: "x" }));
    const ops = await listOutbox(db, id);
    expect(ops.at(-1)?.type).toBe("order.replace");
    expect(ops.at(-1)?.payload.request.discountAboveLimitAccepted).toBe(true);
  });

  it("a server answer with the mark sets the local mark; an answer without the field leaves it false", async () => {
    const marked = await open();
    const a = await saveOrderDraft(marked, env, order());
    await pushOutbox(marked, env, transport([], true), OWNER, { respectBackoff: false, currentDataset: REAL });
    expect((await getDraft(marked, a))?.discountOverLimitAccepted).toBe(true);

    const plain = await open();
    const b = await saveOrderDraft(plain, env, order());
    await pushOutbox(plain, env, transport([], undefined), OWNER, { respectBackoff: false, currentDataset: REAL });
    expect((await getDraft(plain, b))?.discountOverLimitAccepted).toBe(false);
  });
});
