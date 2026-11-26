import { beforeEach, describe, expect, it } from "vitest";
import {
  createPendingCustomer,
  createSyncManager,
  getDraft,
  listOutbox,
  migrations,
  pushOutbox,
  pushPendingCustomers,
  runMigrations,
  saveOrderDraft,
  TransportError,
  type CustomerLike,
  type CustomerRegistrationTransport,
  type OfflineEnv,
  type OrderTransport,
  type PendingCustomerRequest,
  type ReferenceSource,
  type RemoteCustomerRegistration,
  type RemoteOrder,
  type SqlDatabase,
} from "../src/index";
import { confirm, REAL } from "./helpers";
import { openNodeDatabase } from "./node-sqlite-connection";

const OWNER = "acct-1";
let clock = new Date("2026-11-26T12:00:00.000Z");
let n = 0;
const env: OfflineEnv = { now: () => clock, newId: () => `id-${String(++n).padStart(4, "0")}` };

const request = (document = "12345678909", name = "Padaria Nova"): PendingCustomerRequest => ({
  document,
  name,
  tradeName: null,
  icmsClassification: "R",
  stateRegistration: null,
  phone: null,
  email: null,
  notes: null,
  addresses: [{ cityCode: 3550308, number: "10" }],
});

/** Records every call in ONE shared log so the order of customers and orders is visible. */
const log: string[] = [];

class Erp implements CustomerRegistrationTransport {
  script: (RemoteCustomerRegistration | TransportError)[] = [];
  keys: string[] = [];
  async getCustomer(code: number): Promise<CustomerLike> {
    return { code, name: "Padaria Nova", document: "12345678909", active: true, blocked: false, sellerCode: 7, sellerName: "Ana", priceTableCode: null };
  }
  async createCustomer(key: string): Promise<RemoteCustomerRegistration> {
    log.push(`customer:${key}`);
    this.keys.push(key);
    const next = this.script.length > 1 ? this.script.shift() : this.script[0];
    if (next === undefined) throw new TransportError("network", "x");
    if (next instanceof TransportError) throw next;
    return next;
  }
}

class Orders implements OrderTransport {
  sent: { key: string; customerCode: number }[] = [];
  async createOrder(key: string, req: { customerCode: number }): Promise<RemoteOrder> {
    log.push(`order:${key}`);
    this.sent.push({ key, customerCode: req.customerCode });
    return {
      id: "remote-1",
      version: 1,
      draftNumber: 1,
      customerCode: req.customerCode,
      customerName: "Padaria Nova",
      negotiationTypeCode: null,
      topCode: null,
      carrierCode: null,
      freightType: null,
      notes: null,
      estimatedTotal: "0.00",
      items: [],
    };
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

const confirmedReg = (code: number): RemoteCustomerRegistration => ({ registrationId: "reg-1", status: "confirmed", customerCode: code });

let db: SqlDatabase;
let erp: Erp;
let orders: Orders;

const draftFor = (customerCode: number, over: { sendRequested?: boolean } = {}) =>
  saveOrderDraft(db, env, { ownerAccountId: OWNER, customerCode, customerName: "Padaria Nova", negotiationTypeCode: null, notes: null, loadedDataset: REAL, items: [], ...over });

const source: ReferenceSource = { fetchCustomers: async () => [], fetchProducts: async () => [], fetchEntryConfiguration: async () => null, fetchDatasetIdentity: async () => REAL };
const manager = () => createSyncManager({ db, env, transport: orders, customerTransport: erp, source, ownerAccountId: OWNER });

beforeEach(async () => {
  log.length = 0;
  db = openNodeDatabase();
  await runMigrations(db, migrations);
  await confirm(db);
  erp = new Erp();
  orders = new Orders();
});

describe("order for a customer created offline", () => {
  it("is saved with the local id and waits: nothing reaches the server before the customer is confirmed", async () => {
    const customer = await createPendingCustomer(db, env, { ownerAccountId: OWNER, request: request() });
    const draftId = await draftFor(customer.localCode, { sendRequested: true });
    expect(customer.localCode).toBeLessThan(0);
    const result = await pushOutbox(db, env, orders, OWNER, { respectBackoff: false, currentDataset: REAL });
    expect(result).toMatchObject({ attempted: 0, stoppedBy: "idle" });
    expect(orders.sent).toEqual([]);
    expect((await listOutbox(db, draftId))[0]).toMatchObject({ state: "pending", attempts: 0, lastError: null });
    expect(await getDraft(db, draftId)).toMatchObject({ customerCode: customer.localCode, sendState: "requested" });
  });

  it("sync sends the customers FIRST (in order), then the orders, and the order carries the real CODPARC", async () => {
    const c1 = await createPendingCustomer(db, env, { ownerAccountId: OWNER, request: request("12345678909", "Um") });
    const c2 = await createPendingCustomer(db, env, { ownerAccountId: OWNER, request: request("98765432100", "Dois") });
    // The order of the SECOND customer is saved before the first customer's order, to prove the queue is by kind, not by creation time.
    const d2 = await draftFor(c2.localCode);
    const d1 = await draftFor(c1.localCode);
    erp.script = [confirmedReg(4001), confirmedReg(4002)];
    const status = await manager().sync("manual");
    expect(status.phase).toBe("idle");
    const kinds = log.map((entry) => entry.split(":")[0]);
    expect(kinds).toEqual(["customer", "customer", "order", "order"]);
    expect(erp.keys).toEqual([c1.clientRequestId, c2.clientRequestId]);
    expect(orders.sent.map((s) => s.customerCode).sort()).toEqual([4001, 4002]);
    expect((await getDraft(db, d1))?.customerCode).toBe(4001);
    expect((await getDraft(db, d2))?.customerCode).toBe(4002);
    expect(orders.sent.every((s) => s.customerCode > 0)).toBe(true);
  });

  it("a refused customer holds its orders in 'Precisa de correção' with the translated cause and the way out; nothing is lost", async () => {
    const customer = await createPendingCustomer(db, env, { ownerAccountId: OWNER, request: request() });
    const draftId = await draftFor(customer.localCode, { sendRequested: true });
    erp.script = [new TransportError("registration_refused", "x", 422, "document_already_registered")];
    await manager().sync("manual");
    expect(orders.sent).toEqual([]);
    const draft = await getDraft(db, draftId);
    expect(draft).toMatchObject({ sendState: "refused", customerCode: customer.localCode });
    expect(draft?.sendError).toContain("Já existe um cliente com este CPF/CNPJ.");
    expect(draft?.sendError).toContain("Procure esse cliente na lista");
    expect((await listOutbox(db, draftId))[0]?.state).toBe("rejected");
    // The order and its customer name are still there for the seller.
    expect(draft?.customerName).toBe("Padaria Nova");
  });

  it("the seller fixes it by choosing another customer: the order is queued again and goes out", async () => {
    const customer = await createPendingCustomer(db, env, { ownerAccountId: OWNER, request: request() });
    const draftId = await draftFor(customer.localCode, { sendRequested: true });
    erp.script = [new TransportError("registration_refused", "x", 422, "document_already_registered")];
    await manager().sync("manual");
    await saveOrderDraft(db, env, { ownerAccountId: OWNER, localId: draftId, customerCode: 777, customerName: "Existente", negotiationTypeCode: null, notes: null, loadedDataset: REAL, items: [], sendRequested: true });
    const result = await pushOutbox(db, env, orders, OWNER, { respectBackoff: false, currentDataset: REAL });
    expect(result.accepted).toBe(1);
    expect(orders.sent).toEqual([{ key: expect.any(String), customerCode: 777 }]);
  });

  it("idempotency: a lost answer then a resend reuses the SAME customer key and the SAME order key (no duplicate of either)", async () => {
    const customer = await createPendingCustomer(db, env, { ownerAccountId: OWNER, request: request() });
    const draftId = await draftFor(customer.localCode);
    erp.script = [new TransportError("network", "x"), confirmedReg(4001)];
    expect((await manager().sync("manual")).phase).toBe("offline");
    expect(orders.sent).toEqual([]);
    await manager().sync("manual");
    expect(erp.keys).toEqual([customer.clientRequestId, customer.clientRequestId]);
    expect(orders.sent).toHaveLength(1);
    expect(orders.sent[0]?.key).toBe((await getDraft(db, draftId))?.clientRequestId);
    // Third run: nothing is sent again.
    await manager().sync("manual");
    expect(orders.sent).toHaveLength(1);
    expect(erp.keys).toHaveLength(2);
  });

  it("a customer discarded from the device sends its orders to correction instead of leaving them stuck", async () => {
    const customer = await createPendingCustomer(db, env, { ownerAccountId: OWNER, request: request() });
    const draftId = await draftFor(customer.localCode, { sendRequested: true });
    await db.execute("DELETE FROM pending_customer WHERE client_request_id = ?", [customer.clientRequestId]);
    await pushOutbox(db, env, orders, OWNER, { respectBackoff: false, currentDataset: REAL });
    expect(await getDraft(db, draftId)).toMatchObject({ sendState: "refused" });
    expect(orders.sent).toEqual([]);
    void pushPendingCustomers;
  });
});
