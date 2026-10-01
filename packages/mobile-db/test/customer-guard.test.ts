import { beforeEach, describe, expect, it } from "vitest";
import {
  countOutbox,
  CUSTOMER_UNAVAILABLE_MESSAGE,
  discardLocalDraft,
  getDraft,
  getDraftItems,
  isCustomerUnavailableMessage,
  listOutbox,
  migrations,
  pushOutbox,
  replaceCustomers,
  runMigrations,
  saveOrderDraft,
  TransportError,
  type CustomerLike,
  type OfflineEnv,
  type OrderCommandPayload,
  type OrderTransport,
  type RemoteOrder,
  type SaveDraftInput,
  type SqlDatabase,
  type TransportErrorKind,
} from "../src/index";
import { confirm, REAL } from "./helpers";
import { openNodeDatabase } from "./node-sqlite-connection";

const OWNER = "acct-1";

function makeEnv(): OfflineEnv {
  let n = 0;
  return { now: () => new Date("2026-09-30T12:00:00.000Z"), newId: () => `id-${String(++n).padStart(4, "0")}` };
}

function input(customerCode: number): SaveDraftInput {
  return {
    ownerAccountId: OWNER,
    customerCode,
    customerName: `Cliente ${customerCode}`,
    negotiationTypeCode: null,
    notes: null,
    loadedDataset: REAL,
    items: [{ productCode: 1, description: "Produto 1", unit: "UN", quantity: "2", discountPercent: "0", priceJson: JSON.stringify({ state: "priced", unitPrice: "10.00" }), groupCode: 1, groupName: "G" }],
  };
}

class Server implements OrderTransport {
  requests: string[] = [];
  failWith: TransportErrorKind | null = null;
  private seq = 0;
  async createOrder(key: string, request: OrderCommandPayload["request"]): Promise<RemoteOrder> {
    this.requests.push(`POST ${key}`);
    if (this.failWith !== null) throw new TransportError(this.failWith, "recusado", 409);
    return this.remote(`order-${++this.seq}`, 1, request);
  }
  async replaceOrder(id: string, version: number, request: OrderCommandPayload["request"]): Promise<RemoteOrder> {
    this.requests.push(`PUT ${id}`);
    return this.remote(id, version + 1, request);
  }
  async getOrder(): Promise<RemoteOrder> {
    throw new TransportError("not_found", "x", 404);
  }
  private remote(id: string, version: number, request: OrderCommandPayload["request"]): RemoteOrder {
    return {
      id,
      version,
      draftNumber: this.seq,
      customerCode: request.customerCode,
      customerName: "Cliente",
      negotiationTypeCode: null,
      notes: null,
      estimatedTotal: "20.00",
      items: request.items.map((line) => ({
        productCode: line.productCode,
        productDescription: "Produto 1",
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
}

let db: SqlDatabase;
let env: OfflineEnv;
let server: Server;
const cache = (customers: CustomerLike[]) => db.transaction((tx) => replaceCustomers(tx, customers));
const push = () => pushOutbox(db, env, server, OWNER, { respectBackoff: false, currentDataset: REAL });

beforeEach(async () => {
  db = openNodeDatabase();
  await runMigrations(db, migrations);
  await confirm(db);
  env = makeEnv();
  server = new Server();
});

describe("customer availability guard (local, indicative)", () => {
  it.each([
    ["blocked", { code: 77, name: "C", blocked: true }],
    ["inactive", { code: 77, name: "C", active: false }],
  ])("holds a draft whose cached customer is %s: nothing is sent, nothing is changed or deleted", async (_label, customer) => {
    await cache([customer]);
    const id = await saveOrderDraft(db, env, input(77));
    const result = await push();
    expect(result).toMatchObject({ attempted: 0, accepted: 0, stoppedBy: "idle" });
    expect(server.requests).toEqual([]);
    const [op] = await listOutbox(db, id);
    expect(op).toMatchObject({ state: "pending", attempts: 0, lastError: CUSTOMER_UNAVAILABLE_MESSAGE });
    const draft = await getDraft(db, id);
    expect(draft).toMatchObject({ status: "sync_error", remoteId: null, lastError: CUSTOMER_UNAVAILABLE_MESSAGE });
    expect(isCustomerUnavailableMessage(draft?.lastError ?? null)).toBe(true);
    expect(await getDraftItems(db, id)).toHaveLength(1);
  });

  it("says it in the seller's words and does not look like a technical error", () => {
    expect(CUSTOMER_UNAVAILABLE_MESSAGE).toBe("Cliente indisponível — revise o rascunho");
    expect(isCustomerUnavailableMessage("Sem conexão")).toBe(false);
    expect(isCustomerUnavailableMessage(null)).toBe(false);
  });

  it("sends normally when the customer is active, or not in the cache (unknown is not ineligible; the server decides)", async () => {
    await cache([{ code: 77, name: "C", active: true, blocked: false }]);
    await saveOrderDraft(db, env, input(77));
    await saveOrderDraft(db, env, input(88));
    const result = await push();
    expect(result.accepted).toBe(2);
  });

  it("holds only the affected draft; other customers' drafts still go out", async () => {
    await cache([{ code: 77, name: "C", blocked: true }]);
    const held = await saveOrderDraft(db, env, input(77));
    const fine = await saveOrderDraft(db, env, input(88));
    const result = await push();
    expect(result).toMatchObject({ attempted: 1, accepted: 1 });
    expect((await getDraft(db, held))?.status).toBe("sync_error");
    expect((await getDraft(db, fine))?.status).toBe("synced");
  });

  it("is not a loop: repeated runs keep holding without attempts, and it counts as needing attention, not pending", async () => {
    await cache([{ code: 77, name: "C", blocked: true }]);
    await saveOrderDraft(db, env, input(77));
    await push();
    await push();
    expect(server.requests).toEqual([]);
    expect(await countOutbox(db, OWNER, REAL)).toEqual({ pending: 0, sending: 0, needsAttention: 1 });
  });

  it("is re-evaluated, never converted: once the customer is available again the same command (same key) goes out", async () => {
    await cache([{ code: 77, name: "C", blocked: true }]);
    const id = await saveOrderDraft(db, env, input(77));
    const [before] = await listOutbox(db, id);
    await push();
    await cache([{ code: 77, name: "C", blocked: false, active: true }]);
    const result = await push();
    expect(result.accepted).toBe(1);
    expect(server.requests).toEqual([`POST ${before?.idempotencyKey}`]);
    expect((await getDraft(db, id))?.status).toBe("synced");
  });

  it("holds an edit of an already-synced draft too, keeping the remote identity", async () => {
    const id = await saveOrderDraft(db, env, input(77));
    await push();
    await cache([{ code: 77, name: "C", blocked: true }]);
    await saveOrderDraft(db, env, { ...input(77), localId: id });
    server.requests.length = 0;
    await push();
    expect(server.requests).toEqual([]);
    expect(await getDraft(db, id)).toMatchObject({ status: "sync_error", lastError: CUSTOMER_UNAVAILABLE_MESSAGE });
    expect((await getDraft(db, id))?.remoteId).not.toBeNull();
  });

  it("a held, never-sent draft can still be discarded by the seller (explicit, local)", async () => {
    await cache([{ code: 77, name: "C", blocked: true }]);
    const id = await saveOrderDraft(db, env, input(77));
    await push();
    await discardLocalDraft(db, OWNER, id);
    expect(await getDraft(db, id)).toBeNull();
  });
});

describe("server answer customer_ineligible", () => {
  it("is permanent: rejected once with the same wording, never retried, draft kept", async () => {
    const id = await saveOrderDraft(db, env, input(77));
    server.failWith = "customer_ineligible";
    await push();
    server.failWith = null;
    await push();
    expect(server.requests).toHaveLength(1);
    const [op] = await listOutbox(db, id);
    expect(op).toMatchObject({ state: "rejected", lastError: CUSTOMER_UNAVAILABLE_MESSAGE });
    expect(await getDraft(db, id)).toMatchObject({ status: "sync_error", lastError: CUSTOMER_UNAVAILABLE_MESSAGE });
    expect(await getDraftItems(db, id)).toHaveLength(1);
  });
});
