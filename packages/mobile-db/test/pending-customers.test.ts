import { beforeEach, describe, expect, it } from "vitest";
import {
  PENDING_CUSTOMER_MESSAGE,
  PendingCustomerError,
  PendingCustomerOrderError,
  countPendingCustomers,
  createPendingCustomer,
  createSyncManager,
  describePendingCustomer,
  discardPendingCustomer,
  getDraft,
  getPendingCustomer,
  getPendingCustomerByLocalCode,
  listOutbox,
  listPendingCustomers,
  maskDocument,
  migrations,
  pendingCustomerBlockOf,
  pushOutbox,
  purgeRefusedCustomers,
  pushPendingCustomers,
  recoverInterruptedCustomers,
  replaceCustomers,
  retryPendingCustomer,
  runMigrations,
  saveOrderDraft,
  settleConfirmedCustomers,
  TransportError,
  type CustomerLike,
  type CustomerRegistrationTransport,
  CUSTOMER_CREATION_NOT_RELEASED,
  isCustomerCreationAvailable,
  redoPendingCustomer,
  searchCustomers,
  type OfflineEnv,
  type OrderTransport,
  type PendingCustomerRequest,
  type ReferenceSource,
  type RemoteCustomerRegistration,
  type SqlDatabase,
  type TransportErrorKind,
} from "../src/index";
import { confirm, FAKE, REAL } from "./helpers";
import { openNodeDatabase } from "./node-sqlite-connection";

const OWNER = "acct-1";

let clock = new Date("2026-11-13T12:00:00.000Z");
function makeEnv(): OfflineEnv {
  let n = 0;
  return { now: () => clock, newId: () => `id-${String(++n).padStart(4, "0")}` };
}

const request = (over: Partial<PendingCustomerRequest> = {}): PendingCustomerRequest => ({
  document: "123.456.789-09",
  name: "Padaria Ação Ltda",
  tradeName: "Padaria Ação",
  icmsClassification: "R",
  stateRegistration: null,
  phone: "11 99999-0000",
  email: null,
  notes: "obs",
  addresses: [{ streetCode: 1, neighborhoodCode: 2, number: "10", complement: null, postalCode: "01001000" }],
  ...over,
});

class Erp implements CustomerRegistrationTransport {
  calls: { key: string; request: PendingCustomerRequest }[] = [];
  reads: number[] = [];
  /** What `GET /customers/{code}` answers; an Error means the read fails. */
  customer: CustomerLike | Error | null = null;
  async getCustomer(code: number): Promise<CustomerLike> {
    this.reads.push(code);
    if (this.customer instanceof Error) throw this.customer;
    return this.customer ?? { code, name: "Padaria Ação Ltda", tradeName: "Padaria Ação", document: "12345678909", active: true, blocked: false, sellerCode: 7, sellerName: "Ana", priceTableCode: null };
  }
  /** Queue of outcomes; the last one repeats. */
  script: (RemoteCustomerRegistration | TransportError)[] = [];
  async createCustomer(key: string, req: PendingCustomerRequest): Promise<RemoteCustomerRegistration> {
    this.calls.push({ key, request: req });
    const next = this.script.length > 1 ? this.script.shift() : this.script[0];
    if (next === undefined) throw new TransportError("network", "x");
    if (next instanceof TransportError) throw next;
    return next;
  }
}
const confirmedReg = (code: number): RemoteCustomerRegistration => ({ registrationId: "reg-1", status: "confirmed", customerCode: code });
const waitingReg = (status: "pending" | "unknown" = "pending"): RemoteCustomerRegistration => ({ registrationId: "reg-1", status, customerCode: null });
const fail = (kind: TransportErrorKind, reason?: string, message = "x") => new TransportError(kind, message, 0, reason);

class Orders implements OrderTransport {
  requests: string[] = [];
  async createOrder(key: string): Promise<never> {
    this.requests.push(key);
    throw new TransportError("network", "x");
  }
  async replaceOrder(): Promise<never> {
    throw new TransportError("network", "x");
  }
  async getOrder(): Promise<never> {
    throw new TransportError("not_found", "x");
  }
}

let db: SqlDatabase;
let env: OfflineEnv;
let erp: Erp;
const push = (over: { respectBackoff?: boolean } = {}) => pushPendingCustomers(db, env, erp, OWNER, { currentDataset: REAL, respectBackoff: false, ...over });
const create = (req = request(), owner = OWNER) => createPendingCustomer(db, env, { ownerAccountId: owner, request: req });

beforeEach(async () => {
  clock = new Date("2026-11-13T12:00:00.000Z");
  db = openNodeDatabase();
  await runMigrations(db, migrations);
  await confirm(db);
  env = makeEnv();
  erp = new Erp();
});

describe("creating a customer without signal", () => {
  it("is durable and queued with a negative local code, digits-only document and the typed data intact", async () => {
    const record = await create();
    expect(record).toMatchObject({ state: "queued", attempts: 0, customerCode: null, document: "12345678909", ownerAccountId: OWNER, dataset: REAL });
    expect(record.localCode).toBeLessThan(0);
    expect(record.request).toMatchObject({ name: "Padaria Ação Ltda", tradeName: "Padaria Ação", notes: "obs", icmsClassification: "R" });
    expect(record.maskedDocument).toBe("***.456.789-**");
    expect(describePendingCustomer(record)).toBe("Aguardando envio ao Sankhya");
    expect(erp.calls).toEqual([]);
  });

  it("never stores a credit limit or price table (only what the seller sends)", async () => {
    const record = await create();
    expect(Object.keys(record.request ?? {}).sort()).toEqual(["addresses", "document", "email", "icmsClassification", "name", "notes", "phone", "stateRegistration", "tradeName"]);
  });

  it("masks the document for display", () => {
    expect(maskDocument("12345678909")).toBe("***.456.789-**");
    expect(maskDocument("12.345.678/0001-95")).toBe("**.***.678/0001-**");
  });

  it("refuses a second open registration of the same document, but allows a new one after a refusal", async () => {
    const first = await create();
    await expect(create(request({ document: "12345678909" }))).rejects.toBeInstanceOf(PendingCustomerError);
    erp.script = [fail("registration_refused", "document_already_registered")];
    await push();
    expect((await getPendingCustomer(db, OWNER, first.clientRequestId))?.state).toBe("rejected");
    await expect(create()).resolves.toMatchObject({ state: "queued" });
  });

  it("needs a confirmed dataset", async () => {
    const other = openNodeDatabase();
    await runMigrations(other, migrations);
    await expect(createPendingCustomer(other, env, { ownerAccountId: OWNER, request: request() })).rejects.toThrow();
  });

  it("appears in the list immediately, found by name (accent-insensitive) or document digits", async () => {
    await create();
    expect((await listPendingCustomers(db, OWNER, REAL, "acao")).map((r) => r.name)).toEqual(["Padaria Ação Ltda"]);
    expect(await listPendingCustomers(db, OWNER, REAL, "456789")).toHaveLength(1);
    expect(await listPendingCustomers(db, OWNER, REAL, "zzz")).toHaveLength(0);
  });
});

describe("delivery with the same key", () => {
  it("a network failure keeps it queued; every retry sends the SAME key and no second customer is created", async () => {
    const record = await create();
    erp.script = [fail("network"), fail("server"), waitingReg()];
    expect(await push()).toMatchObject({ attempted: 1, stoppedBy: "offline" });
    expect(await getPendingCustomer(db, OWNER, record.clientRequestId)).toMatchObject({ state: "queued", attempts: 1 });
    await push(); // 5xx
    expect(await getPendingCustomer(db, OWNER, record.clientRequestId)).toMatchObject({ state: "queued", attempts: 2 });
    await push();
    expect(new Set(erp.calls.map((c) => c.key))).toEqual(new Set([record.clientRequestId]));
    expect(erp.calls).toHaveLength(3);
    expect(erp.calls.every((c) => JSON.stringify(c.request) === JSON.stringify(record.request))).toBe(true);
  });

  it("429 stays queued with backoff", async () => {
    const record = await create();
    erp.script = [fail("rate_limit")];
    await push();
    const after = await getPendingCustomer(db, OWNER, record.clientRequestId);
    expect(after?.state).toBe("queued");
    expect(after?.nextAttemptAt).not.toBeNull();
    expect(await push({ respectBackoff: true })).toMatchObject({ attempted: 0 });
  });

  it.each(["pending", "unknown"] as const)("a %s answer is 'waiting for the ERP', asked again with the same key", async (status) => {
    const record = await create();
    erp.script = [waitingReg(status), waitingReg(status)];
    await push();
    const waiting = await getPendingCustomer(db, OWNER, record.clientRequestId);
    expect(waiting).toMatchObject({ state: "awaiting_erp", registrationId: "reg-1", customerCode: null });
    expect(describePendingCustomer(waiting as NonNullable<typeof waiting>)).toBe("Aguardando confirmação do Sankhya");
    await push();
    expect(erp.calls.map((c) => c.key)).toEqual([record.clientRequestId, record.clientRequestId]);
  });

  it("a network drop while waiting returns to 'waiting', not to 'queued' (the server already has it)", async () => {
    const record = await create();
    erp.script = [waitingReg(), fail("network")];
    await push();
    await push();
    expect((await getPendingCustomer(db, OWNER, record.clientRequestId))?.state).toBe("awaiting_erp");
  });

  it("auth failure keeps it queued without backoff and stops the run", async () => {
    const record = await create();
    erp.script = [fail("auth")];
    expect(await push()).toMatchObject({ stoppedBy: "auth" });
    expect(await getPendingCustomer(db, OWNER, record.clientRequestId)).toMatchObject({ state: "queued", nextAttemptAt: null });
  });

  it("a send interrupted by an app kill goes back to the queue with the same key", async () => {
    const record = await create();
    await db.execute("UPDATE pending_customer SET state = 'sending', attempts = 1 WHERE client_request_id = ?", [record.clientRequestId]);
    expect(await recoverInterruptedCustomers(db, env)).toBe(1);
    expect((await getPendingCustomer(db, OWNER, record.clientRequestId))?.state).toBe("queued");
    erp.script = [waitingReg()];
    await push();
    expect(erp.calls[0]?.key).toBe(record.clientRequestId);
  });

  it("retry makes a waiting row due now", async () => {
    const record = await create();
    erp.script = [waitingReg()];
    await push();
    expect(await push({ respectBackoff: true })).toMatchObject({ attempted: 0 });
    await retryPendingCustomer(db, env, OWNER, record.clientRequestId);
    expect(await push({ respectBackoff: true })).toMatchObject({ attempted: 1 });
  });
});

describe("refusals", () => {
  it.each([
    ["document_already_registered", "Já existe um cliente com este CPF/CNPJ."],
    ["customer_rejected", "O Sankhya recusou o cadastro do cliente. Confira os dados."],
  ])("409 %s -> rejected with a readable reason, typed data kept for the 7-day window (owner 2026-11-13), never resent", async (reason, text) => {
    const record = await create();
    erp.script = [fail("registration_refused", reason)];
    expect(await push()).toMatchObject({ rejected: 1 });
    const after = await getPendingCustomer(db, OWNER, record.clientRequestId);
    expect(after).toMatchObject({ state: "rejected", rejectionReason: text, name: "Padaria Ação Ltda", document: "12345678909", maskedDocument: "***.456.789-**" });
    expect(after?.request).not.toBeNull();
    expect(describePendingCustomer(after as NonNullable<typeof after>)).toBe(`Não aceito: ${text}`);
    await push();
    expect(erp.calls).toHaveLength(1);
    await expect(retryPendingCustomer(db, env, OWNER, record.clientRequestId)).rejects.toBeInstanceOf(PendingCustomerError);
  });

  it("400 validation -> rejected with the server's words, data kept", async () => {
    const record = await create();
    erp.script = [fail("validation", undefined, "CPF/CNPJ inválido.")];
    await push();
    expect(await getPendingCustomer(db, OWNER, record.clientRequestId)).toMatchObject({ state: "rejected", rejectionReason: "CPF/CNPJ inválido." });
  });

  it("customer_write_disabled (409) stays queued with the 'not released' text, is not a refusal and does not hammer the other rows", async () => {
    const record = await create();
    const second = await create(request({ document: "98765432100" }));
    erp.script = [fail("server", "customer_write_disabled")];
    await push();
    const after = await getPendingCustomer(db, OWNER, record.clientRequestId);
    expect(after).toMatchObject({ state: "queued", rejectionReason: null, lastError: CUSTOMER_CREATION_NOT_RELEASED });
    expect(CUSTOMER_CREATION_NOT_RELEASED).toBe("Cadastro de cliente ainda não liberado, vamos tentar de novo");
    expect(describePendingCustomer(after as NonNullable<typeof after>)).toBe(CUSTOMER_CREATION_NOT_RELEASED);
    expect((await getPendingCustomer(db, OWNER, second.clientRequestId))?.attempts).toBe(0);
    expect(erp.calls).toHaveLength(1);
    expect(await countPendingCustomers(db, OWNER, REAL)).toEqual({ pending: 2, needsAttention: 0 });
  });

  it("a refused customer can be discarded locally; an in-flight one cannot", async () => {
    const refused = await create();
    erp.script = [fail("registration_refused", "customer_rejected")];
    await push();
    await discardPendingCustomer(db, OWNER, refused.clientRequestId);
    expect(await getPendingCustomer(db, OWNER, refused.clientRequestId)).toBeNull();

    const waiting = await create(request({ document: "98765432100" }));
    erp.script = [waitingReg()];
    await push();
    await expect(discardPendingCustomer(db, OWNER, waiting.clientRequestId)).rejects.toBeInstanceOf(PendingCustomerError);
  });

  it("a never-sent customer can be discarded", async () => {
    const record = await create();
    await discardPendingCustomer(db, OWNER, record.clientRequestId);
    expect(await listPendingCustomers(db, OWNER, REAL)).toEqual([]);
  });
});

describe("confirmation replaces the pending customer", () => {
  async function draftOnPending(localCode: number, name: string): Promise<string> {
    // Defensive path: a draft that somehow carries the local code (the guard below refuses to create one).
    await db.execute(
      `INSERT INTO local_order_draft (local_id, owner_account_id, client_request_id, customer_code, customer_name, status, created_at, updated_at, dataset_environment, dataset_id, eligibility)
       VALUES ('draft-x', ?, 'req-x', ?, ?, 'pending_sync', 'a', 'a', ?, ?, 'eligible')`,
      [OWNER, localCode, name, REAL.environment, REAL.datasetId],
    );
    await db.execute(
      `INSERT INTO outbox (local_id, operation_id, idempotency_key, type, payload, state, attempts, draft_local_id, created_at, updated_at, dataset_environment, dataset_id, eligibility)
       VALUES ('op-x', 'opid-x', 'req-x', 'order.create', ?, 'pending', 0, 'draft-x', 'a', 'a', ?, ?, 'eligible')`,
      [JSON.stringify({ request: { customerCode: localCode, negotiationTypeCode: null, notes: null, items: [] }, prices: [] }), REAL.environment, REAL.datasetId],
    );
    return "draft-x";
  }

  it("on 201 the drafts that pointed to the pending customer are re-pointed to the ERP code (name kept), commands included", async () => {
    const record = await create();
    const draftId = await draftOnPending(record.localCode, "Padaria Ação Ltda");
    erp.script = [confirmedReg(4321)];
    erp.customer = new TransportError("network", "x"); // the read of the real record fails: confirmed, waiting for its data
    expect(await push()).toMatchObject({ confirmed: 1 });
    expect(await getPendingCustomer(db, OWNER, record.clientRequestId)).toMatchObject({ state: "confirmed", customerCode: 4321 });
    expect(await getDraft(db, draftId)).toMatchObject({ customerCode: 4321, customerName: "Padaria Ação Ltda" });
    const [op] = await listOutbox(db, draftId);
    expect(op?.payload.request.customerCode).toBe(4321);
  });

  it("only the owner's drafts are re-pointed", async () => {
    const record = await create();
    await db.execute(
      `INSERT INTO local_order_draft (local_id, owner_account_id, client_request_id, customer_code, customer_name, status, created_at, updated_at, dataset_environment, dataset_id, eligibility)
       VALUES ('other', 'acct-2', 'req-o', ?, 'X', 'pending_sync', 'a', 'a', ?, ?, 'eligible')`,
      [record.localCode, REAL.environment, REAL.datasetId],
    );
    erp.script = [confirmedReg(4321)];
    await push();
    expect((await getDraft(db, "other"))?.customerCode).toBe(record.localCode);
  });

  it("on 201 the REAL customer is written to the device cache at once, the pending row goes, drafts are re-pointed and an order can start immediately", async () => {
    const record = await create();
    const draftId = await draftOnPending(record.localCode, "Padaria Ação Ltda");
    erp.script = [confirmedReg(4321)];
    expect(await push()).toMatchObject({ confirmed: 1 });
    expect(erp.reads).toEqual([4321]);
    expect(await getPendingCustomer(db, OWNER, record.clientRequestId)).toBeNull();
    expect(await listPendingCustomers(db, OWNER, REAL)).toEqual([]);
    const cached = await searchCustomers<CustomerLike>(db, { search: "", page: 1, pageSize: 20 });
    expect(cached.items).toEqual([expect.objectContaining({ code: 4321, name: "Padaria Ação Ltda", active: true, blocked: false })]);
    expect((await getDraft(db, draftId))?.customerCode).toBe(4321);
    await expect(saveOrderDraft(db, env, { ownerAccountId: OWNER, customerCode: 4321, customerName: "Padaria", negotiationTypeCode: null, notes: null, loadedDataset: REAL, items: [] })).resolves.toBeTypeOf("string");
  });

  it("following a 202 until it confirms does the same", async () => {
    const record = await create();
    erp.script = [waitingReg(), confirmedReg(4321)];
    await push();
    expect(erp.reads).toEqual([]);
    await push();
    expect(erp.reads).toEqual([4321]);
    expect(await getPendingCustomer(db, OWNER, record.clientRequestId)).toBeNull();
    expect((await searchCustomers<CustomerLike>(db, { search: "ação", page: 1, pageSize: 20 })).total).toBe(1);
  });

  it("when the read of the real record fails the row stays 'confirmed, waiting for data': listed under the REAL code, orders allowed, and only the read is retried (never a second create)", async () => {
    const record = await create();
    erp.script = [confirmedReg(4321)];
    erp.customer = new TransportError("server", "x");
    await push();
    const waiting = await getPendingCustomer(db, OWNER, record.clientRequestId);
    expect(waiting).toMatchObject({ state: "confirmed", customerCode: 4321 });
    expect(describePendingCustomer(waiting as NonNullable<typeof waiting>)).toBe("Confirmado no Sankhya — carregando dados");
    expect(pendingCustomerBlockOf(4321)).toBeNull();
    await expect(saveOrderDraft(db, env, { ownerAccountId: OWNER, customerCode: 4321, customerName: "Padaria", negotiationTypeCode: null, notes: null, loadedDataset: REAL, items: [] })).resolves.toBeTypeOf("string");
    erp.customer = null;
    await push();
    expect(erp.calls).toHaveLength(1);
    expect(erp.reads).toEqual([4321, 4321]);
    expect(await getPendingCustomer(db, OWNER, record.clientRequestId)).toBeNull();
    expect((await searchCustomers<CustomerLike>(db, { search: "", page: 1, pageSize: 20 })).total).toBe(1);
  });

  it("the pending row is replaced (removed) when the normal pull delivers the real customer: never listed twice", async () => {
    const record = await create();
    erp.script = [confirmedReg(4321)];
    erp.customer = new TransportError("network", "x");
    await push();
    expect(await listPendingCustomers(db, OWNER, REAL)).toHaveLength(1); // confirmed, mirror not here yet
    await db.transaction(async (tx) => {
      await replaceCustomers(tx, [{ code: 4321, name: "Padaria Ação Ltda" }]);
      await settleConfirmedCustomers(tx);
    });
    expect(await getPendingCustomer(db, OWNER, record.clientRequestId)).toBeNull();
    expect(await listPendingCustomers(db, OWNER, REAL)).toEqual([]);
  });

  it("the real pull inside the sync manager settles it", async () => {
    await create();
    erp.script = [confirmedReg(4321)];
    const source: ReferenceSource = {
      fetchCustomers: async () => [{ code: 4321, name: "Padaria Ação Ltda" }],
      fetchProducts: async () => [],
      fetchEntryConfiguration: async () => null,
      fetchDatasetIdentity: async () => REAL,
    };
    const manager = createSyncManager({ db, env, transport: new Orders(), customerTransport: erp, source, ownerAccountId: OWNER });
    const status = await manager.sync("manual");
    expect(status.phase).toBe("idle");
    expect(await listPendingCustomers(db, OWNER, REAL)).toEqual([]);
    expect(pendingCustomerBlockOf(4321)).toBeNull();
  });

  it("the sync manager reports offline when the customer push hits a dead network, and counts it as pending", async () => {
    await create();
    erp.script = [fail("network")];
    const source: ReferenceSource = {
      fetchCustomers: async () => [],
      fetchProducts: async () => [],
      fetchEntryConfiguration: async () => null,
      fetchDatasetIdentity: async () => REAL,
    };
    const manager = createSyncManager({ db, env, transport: new Orders(), customerTransport: erp, source, ownerAccountId: OWNER });
    expect(await manager.sync("manual")).toMatchObject({ phase: "offline", pending: 1 });
  });
});

describe("orders are blocked for a customer the ERP has not confirmed", () => {
  const draftInput = (customerCode: number) => ({
    ownerAccountId: OWNER,
    customerCode,
    customerName: "Padaria",
    negotiationTypeCode: null,
    notes: null,
    loadedDataset: REAL,
    items: [{ productCode: 1, description: "P", unit: "UN", quantity: "1", discountPercent: "0", priceJson: JSON.stringify({ state: "priced", unitPrice: "1.00" }), groupCode: null, groupName: null }],
  });

  it("refuses to save a draft for a pending (negative-code) customer, with the exact text", async () => {
    const record = await create();
    await expect(saveOrderDraft(db, env, draftInput(record.localCode))).rejects.toBeInstanceOf(PendingCustomerOrderError);
    await expect(saveOrderDraft(db, env, draftInput(record.localCode))).rejects.toThrow("Este cliente ainda não foi confirmado pelo Sankhya.");
    expect(PENDING_CUSTOMER_MESSAGE).toBe("Este cliente ainda não foi confirmado pelo Sankhya.");
  });

  it("a rejected customer's local code is blocked too", async () => {
    const record = await create();
    erp.script = [fail("registration_refused", "customer_rejected")];
    await push();
    await expect(saveOrderDraft(db, env, draftInput(record.localCode))).rejects.toBeInstanceOf(PendingCustomerOrderError);
  });

  it("the negative local code never reaches an order command: a command carrying it is held, never handed to the transport", async () => {
    const orders = new Orders();
    await db.execute(
      `INSERT INTO local_order_draft (local_id, owner_account_id, client_request_id, customer_code, customer_name, status, created_at, updated_at, dataset_environment, dataset_id, eligibility)
       VALUES ('dn', ?, 'kn', -9, 'P', 'pending_sync', '2026-11-13T00:00:00.000Z', '2026-11-13T00:00:00.000Z', ?, ?, 'eligible')`,
      [OWNER, REAL.environment, REAL.datasetId],
    );
    await db.execute(
      `INSERT INTO outbox (local_id, operation_id, idempotency_key, type, payload, state, attempts, draft_local_id, created_at, updated_at, dataset_environment, dataset_id, eligibility)
       VALUES ('on', 'oidn', 'kn', 'order.create', '{"request":{"customerCode":-9,"negotiationTypeCode":null,"notes":null,"items":[]},"prices":[]}', 'pending', 0, 'dn', '2026-11-13T00:00:00.000Z', '2026-11-13T00:00:00.000Z', ?, ?, 'eligible')`,
      [REAL.environment, REAL.datasetId],
    );
    await pushOutbox(db, env, orders, OWNER, { respectBackoff: false, currentDataset: REAL });
    expect(orders.requests).toEqual([]);
  });

  it("a draft that already carries a pending code is never sent: held with the same text, zero attempts", async () => {
    const record = await create();
    await db.execute(
      `INSERT INTO local_order_draft (local_id, owner_account_id, client_request_id, customer_code, customer_name, status, created_at, updated_at, dataset_environment, dataset_id, eligibility)
       VALUES ('d1', ?, 'k1', ?, 'P', 'pending_sync', '2026-11-13T00:00:00.000Z', '2026-11-13T00:00:00.000Z', ?, ?, 'eligible')`,
      [OWNER, record.localCode, REAL.environment, REAL.datasetId],
    );
    await db.execute(
      `INSERT INTO outbox (local_id, operation_id, idempotency_key, type, payload, state, attempts, draft_local_id, created_at, updated_at, dataset_environment, dataset_id, eligibility)
       VALUES ('o1', 'oid1', 'k1', 'order.create', '{"request":{"customerCode":${record.localCode},"negotiationTypeCode":null,"notes":null,"items":[]},"prices":[]}', 'pending', 0, 'd1', '2026-11-13T00:00:00.000Z', '2026-11-13T00:00:00.000Z', ?, ?, 'eligible')`,
      [REAL.environment, REAL.datasetId],
    );
    const orders = new Orders();
    const result = await pushOutbox(db, env, orders, OWNER, { respectBackoff: false, currentDataset: REAL });
    expect(result).toMatchObject({ attempted: 0, stoppedBy: "idle" });
    expect(orders.requests).toEqual([]);
    expect((await listOutbox(db, "d1"))[0]).toMatchObject({ state: "pending", attempts: 0, lastError: PENDING_CUSTOMER_MESSAGE });
  });

  it("an ordinary customer is unaffected", async () => {
    expect(pendingCustomerBlockOf(77)).toBeNull();
    await expect(saveOrderDraft(db, env, draftInput(77))).resolves.toBeTypeOf("string");
  });
});

describe("isolation by account and dataset", () => {
  it("another account never sees, counts or sends this account's pending customers", async () => {
    const mine = await create();
    expect(await listPendingCustomers(db, "acct-2", REAL)).toEqual([]);
    expect(await getPendingCustomer(db, "acct-2", mine.clientRequestId)).toBeNull();
    expect(await getPendingCustomerByLocalCode(db, "acct-2", mine.localCode)).toBeNull();
    expect(await getPendingCustomerByLocalCode(db, OWNER, mine.localCode)).toMatchObject({ clientRequestId: mine.clientRequestId });
    erp.script = [waitingReg()];
    expect(await pushPendingCustomers(db, env, erp, "acct-2", { currentDataset: REAL, respectBackoff: false })).toMatchObject({ attempted: 0 });
    expect(erp.calls).toEqual([]);
    await expect(discardPendingCustomer(db, "acct-2", mine.clientRequestId)).resolves.toBeUndefined();
    expect(await getPendingCustomer(db, OWNER, mine.clientRequestId)).not.toBeNull();
    await expect(retryPendingCustomer(db, env, "acct-2", mine.clientRequestId)).rejects.toBeInstanceOf(PendingCustomerError);
  });

  it("a row of another dataset is neither listed nor sent, and nothing is sent without a confirmed dataset", async () => {
    await create();
    expect(await listPendingCustomers(db, OWNER, FAKE)).toEqual([]);
    expect(await listPendingCustomers(db, OWNER, null)).toEqual([]);
    erp.script = [waitingReg()];
    expect(await pushPendingCustomers(db, env, erp, OWNER, { currentDataset: FAKE, respectBackoff: false })).toMatchObject({ attempted: 0 });
    expect(await pushPendingCustomers(db, env, erp, OWNER, { currentDataset: null, respectBackoff: false })).toMatchObject({ attempted: 0, stoppedBy: "dataset_unconfirmed" });
    expect(erp.calls).toEqual([]);
    expect(await countPendingCustomers(db, OWNER, FAKE)).toEqual({ pending: 0, needsAttention: 1 });
    expect(await countPendingCustomers(db, OWNER, REAL)).toEqual({ pending: 1, needsAttention: 0 });
  });
});

describe("is customer creation available? (derived from the last server answer)", () => {
  it("is available until the server says the write path is off", async () => {
    expect(await isCustomerCreationAvailable(db, env)).toBe(true);
    await create();
    erp.script = [fail("server", "customer_write_disabled")];
    await push();
    expect(await isCustomerCreationAvailable(db, env)).toBe(false);
  });

  it("any accepted answer (201/200/202) turns it back on", async () => {
    await create();
    erp.script = [fail("server", "customer_write_disabled"), waitingReg()];
    await push();
    await push();
    expect(await isCustomerCreationAvailable(db, env)).toBe(true);
  });

  it("an ordinary outage does not switch it off", async () => {
    await create();
    erp.script = [fail("network")];
    await push();
    expect(await isCustomerCreationAvailable(db, env)).toBe(true);
  });

  it("the 'off' answer has no expiry (owner 2026-11-13): only a sync that says 'on' turns it back", async () => {
    await create();
    erp.script = [fail("server", "customer_write_disabled")];
    await push();
    clock = new Date("2026-11-13T12:59:00.000Z");
    expect(await isCustomerCreationAvailable(db, env)).toBe(false);
    clock = new Date("2026-11-14T13:01:00.000Z");
    expect(await isCustomerCreationAvailable(db, env)).toBe(false);
  });
});

describe("I-2 (owner rulings 2026-11-13): personal data does not outlive the server's answer", () => {
  const PERSONAL = ["12345678909", "Padaria Ação", "11 99999-0000", "obs", "01001000", "123.456.789-09"];
  async function rowDump(): Promise<string> {
    return JSON.stringify(await db.query("SELECT * FROM pending_customer"));
  }

  it("while waiting for the server the typed data is kept (it may still have to be resent with the same key)", async () => {
    await create(request({ email: "dono@padaria.example" }));
    const dump = await rowDump();
    expect(dump).toContain("12345678909");
    expect(dump).toContain("dono@padaria.example");
  });

  const DAY = 24 * 60 * 60 * 1000;
  const refusedRow = async (over: Partial<PendingCustomerRequest> = {}) => {
    const record = await create(request({ email: "dono@padaria.example", ...over }));
    erp.script = [fail("registration_refused", "customer_rejected")];
    await push();
    return record;
  };

  it("a refusal keeps what the seller typed for up to 7 days (to redo); the list identifies it by name, masked document and reason", async () => {
    const record = await refusedRow();
    const row = await getPendingCustomer(db, OWNER, record.clientRequestId);
    expect(row).toMatchObject({ state: "rejected", name: "Padaria Ação Ltda", document: "12345678909", maskedDocument: "***.456.789-**", rejectionReason: "O Sankhya recusou o cadastro do cliente. Confira os dados." });
    expect(row?.request).toMatchObject({ email: "dono@padaria.example", phone: "11 99999-0000" });
    expect(await listPendingCustomers(db, OWNER, REAL, "padaria")).toHaveLength(1);
  });

  it("after 7 days a purge erases every typed field of the refused row (an unreferenced one is removed); before that nothing changes", async () => {
    const record = await refusedRow();
    clock = new Date(clock.getTime() + 7 * DAY - 1000);
    expect(await purgeRefusedCustomers(db, env)).toBe(0);
    expect(await getPendingCustomer(db, OWNER, record.clientRequestId)).toMatchObject({ document: "12345678909" });
    clock = new Date(clock.getTime() + 1000);
    expect(await purgeRefusedCustomers(db, env)).toBe(1);
    expect(await rowDump()).toBe("[]");
    expect(await getPendingCustomer(db, OWNER, record.clientRequestId)).toBeNull();
  });

  it("a refused row still referenced by a draft is erased but never deleted", async () => {
    const record = await refusedRow();
    await db.execute(
      `INSERT INTO local_order_draft (local_id, owner_account_id, client_request_id, customer_code, customer_name, status, created_at, updated_at, dataset_environment, dataset_id, eligibility)
       VALUES ('d1', ?, 'k1', ?, 'P', 'pending_sync', '2026-11-13T00:00:00.000Z', '2026-11-13T00:00:00.000Z', ?, ?, 'eligible')`,
      [OWNER, record.localCode, REAL.environment, REAL.datasetId],
    );
    clock = new Date(clock.getTime() + 8 * DAY);
    expect(await purgeRefusedCustomers(db, env)).toBe(1);
    expect(await getPendingCustomer(db, OWNER, record.clientRequestId)).toMatchObject({ state: "rejected", name: "", document: "", request: null, maskedDocument: "***.456.789-**" });
    const dump = JSON.stringify(await db.query("SELECT * FROM pending_customer"));
    for (const value of [...PERSONAL, "dono@padaria.example", "Padaria Ação Ltda"]) expect(dump).not.toContain(value);
    // a second purge has nothing left to do
    expect(await purgeRefusedCustomers(db, env)).toBe(0);
  });

  it("a refused row referenced only by an outbox command is kept too", async () => {
    const record = await refusedRow();
    await db.execute(
      `INSERT INTO outbox (local_id, operation_id, idempotency_key, type, payload, state, attempts, created_at, updated_at, dataset_environment, dataset_id, eligibility)
       VALUES ('o1', 'oid1', 'k1', 'order.create', '{"request":{"customerCode":${record.localCode},"items":[]},"prices":[]}', 'pending', 0, 'a', 'a', ?, ?, 'eligible')`,
      [REAL.environment, REAL.datasetId],
    );
    clock = new Date(clock.getTime() + 8 * DAY);
    await purgeRefusedCustomers(db, env);
    expect(await getPendingCustomer(db, OWNER, record.clientRequestId)).toMatchObject({ state: "rejected", document: "", request: null });
  });

  it("redo within the window hands the typed data back to pre-fill; after the purge it needs retyping", async () => {
    const record = await refusedRow();
    expect(await redoPendingCustomer(db, OWNER, record.clientRequestId)).toMatchObject({ name: "Padaria Ação Ltda", email: "dono@padaria.example" });
    clock = new Date(clock.getTime() + 8 * DAY);
    await purgeRefusedCustomers(db, env);
    await expect(redoPendingCustomer(db, OWNER, record.clientRequestId)).rejects.toBeInstanceOf(PendingCustomerError);
  });

  it("redoing (replacesRejected) or discarding removes the typed data at once, before the 7 days", async () => {
    const first = await refusedRow();
    await createPendingCustomer(db, env, { ownerAccountId: OWNER, request: request({ name: "Outra Padaria", document: "98765432100" }), replacesRejected: first.clientRequestId });
    expect(await rowDump()).not.toContain("12345678909");
    erp.script = [fail("registration_refused", "customer_rejected")];
    await push();
    const second = (await listPendingCustomers(db, OWNER, REAL))[0];
    await discardPendingCustomer(db, OWNER, (second as NonNullable<typeof second>).clientRequestId);
    expect(await rowDump()).toBe("[]");
  });

  it("the purge covers every account's rows on the device and never touches a customer still waiting", async () => {
    await refusedRow();
    const waiting = await create(request({ document: "98765432100" }), "acct-2");
    clock = new Date(clock.getTime() + 30 * DAY);
    expect(await purgeRefusedCustomers(db, env)).toBe(1);
    expect(await getPendingCustomer(db, "acct-2", waiting.clientRequestId)).toMatchObject({ state: "queued", document: "98765432100" });
  });

  it("the sync manager purges on every run and on refresh (app start / foreground), by the injected clock", async () => {
    const record = await refusedRow();
    const source: ReferenceSource = { fetchCustomers: async () => [], fetchProducts: async () => [], fetchEntryConfiguration: async () => null, fetchDatasetIdentity: async () => REAL };
    const manager = createSyncManager({ db, env, transport: new Orders(), customerTransport: erp, source, ownerAccountId: OWNER });
    clock = new Date(clock.getTime() + 8 * DAY);
    await manager.refresh();
    expect(await getPendingCustomer(db, OWNER, record.clientRequestId)).toBeNull();
    const second = await refusedRow({ document: "11122233396" });
    clock = new Date(clock.getTime() + 8 * DAY);
    await manager.sync("foreground", { pull: false });
    expect(await getPendingCustomer(db, OWNER, second.clientRequestId)).toBeNull();
  });

  it("a confirmation erases document, e-mail and phone (and everything else typed) at once; only the name and the ERP code stay", async () => {
    const record = await create(request({ email: "dono@padaria.example" }));
    erp.script = [confirmedReg(4321)];
    erp.customer = new TransportError("network", "x");
    await push();
    const dump = await rowDump();
    for (const value of ["12345678909", "123.456.789-09", "11 99999-0000", "dono@padaria.example", "obs", "01001000"]) expect(dump).not.toContain(value);
    expect(await getPendingCustomer(db, OWNER, record.clientRequestId)).toMatchObject({ state: "confirmed", customerCode: 4321, request: null, name: "Padaria Ação Ltda", document: "", maskedDocument: "" });
    expect(await listPendingCustomers(db, OWNER, REAL, "padaria")).toHaveLength(1);
    expect(await listPendingCustomers(db, OWNER, REAL, "123456")).toEqual([]);
  });

  it("a confirmation whose real record could not be read yet keeps only the ERP code and identifiers", async () => {
    const record = await create(request({ email: "dono@padaria.example" }));
    erp.script = [confirmedReg(4321)];
    erp.customer = new TransportError("network", "x");
    await push();
    const dump = await rowDump();
    for (const value of [...PERSONAL.filter((v) => v !== "Padaria Ação"), "dono@padaria.example"]) expect(dump).not.toContain(value);
    expect(await getPendingCustomer(db, OWNER, record.clientRequestId)).toMatchObject({ state: "confirmed", customerCode: 4321, registrationId: "reg-1", request: null, name: "Padaria Ação Ltda" });
    // the retry of the read still works with only the code, and never creates a second customer
    erp.customer = null;
    await push();
    expect(erp.calls).toHaveLength(1);
    expect(await getPendingCustomer(db, OWNER, record.clientRequestId)).toBeNull();
  });

  it("the document of a refused row no longer blocks a new registration of that document, as before", async () => {
    await create();
    erp.script = [fail("registration_refused", "customer_rejected")];
    await push();
    await expect(create()).resolves.toMatchObject({ state: "queued" });
  });

  it("a purged row is never found by name or document search", async () => {
    await create();
    erp.script = [fail("registration_refused", "customer_rejected")];
    await push();
    clock = new Date(clock.getTime() + 8 * DAY);
    await purgeRefusedCustomers(db, env);
    expect(await listPendingCustomers(db, OWNER, REAL, "padaria")).toEqual([]);
    expect(await listPendingCustomers(db, OWNER, REAL, "123456")).toEqual([]);
  });

  it("migration v8 erases rows already refused or confirmed under v7 and keeps the masked document", async () => {
    const old = openNodeDatabase();
    await runMigrations(old, migrations.filter((m) => m.version <= 7));
    await confirm(old);
    for (const [id, state, doc] of [
      ["r1", "rejected", "12345678909"],
      ["c1", "confirmed", "12345678000195"],
      ["q1", "queued", "98765432100"],
    ] as const) {
      await old.execute(
        `INSERT INTO pending_customer (client_request_id, owner_account_id, name, search_text, document, payload, state, customer_code, rejection_reason, dataset_environment, dataset_id, created_at, updated_at)
         VALUES (?, ?, 'Nome Pessoal', 'nome pessoal', ?, '{"name":"Nome Pessoal","phone":"119"}', ?, ?, ?, ?, ?, 'a', 'a')`,
        [id, OWNER, doc, state, state === "confirmed" ? 77 : null, state === "rejected" ? "motivo" : null, REAL.environment, REAL.datasetId],
      );
    }
    await runMigrations(old, migrations);
    const dump = JSON.stringify(await old.query("SELECT * FROM pending_customer WHERE client_request_id IN ('r1', 'c1')"));
    expect(dump).not.toContain("Nome Pessoal");
    expect(dump).not.toContain("12345678909");
    expect(dump).not.toContain("12345678000195");
    expect(await getPendingCustomer(old, OWNER, "r1")).toMatchObject({ rejectionReason: "motivo", maskedDocument: "***.456.789-**", request: null });
    expect(await getPendingCustomer(old, OWNER, "c1")).toMatchObject({ customerCode: 77, maskedDocument: "**.***.678/0001-**" });
    expect(await getPendingCustomer(old, OWNER, "q1")).toMatchObject({ name: "Nome Pessoal", document: "98765432100", maskedDocument: "***.654.321-**" });
  });
});

describe("lifecycle: same treatment as pending orders (not wiped on sign-out or account switch, isolated by account)", () => {
  it("another account's sync/pull and a sign-out of this one never delete the queue; the owner finds it again", async () => {
    const mine = await create();
    // sign-out only forgets the remembered account (no call reaches mobile-db); another account then syncs on the same device:
    const source: ReferenceSource = { fetchCustomers: async () => [], fetchProducts: async () => [], fetchEntryConfiguration: async () => null, fetchDatasetIdentity: async () => REAL };
    await createSyncManager({ db, env, transport: new Orders(), customerTransport: erp, source, ownerAccountId: "acct-2" }).sync("manual");
    expect(await listPendingCustomers(db, "acct-2", REAL)).toEqual([]);
    expect(await getPendingCustomer(db, OWNER, mine.clientRequestId)).toMatchObject({ state: "queued", request: expect.objectContaining({ document: "12345678909" }) });
  });
});

describe("redo a refused customer", () => {
  async function refused(): Promise<string> {
    const record = await create();
    erp.script = [fail("registration_refused", "document_already_registered")];
    await push();
    return record.clientRequestId;
  }

  it("redo hands back what was typed (within the 7 days) and the refused row stays, with its reason, until the new one exists", async () => {
    const id = await refused();
    expect(await redoPendingCustomer(db, OWNER, id)).toMatchObject({ name: "Padaria Ação Ltda", document: "12345678909" });
    expect(await getPendingCustomer(db, OWNER, id)).toMatchObject({ state: "rejected", rejectionReason: "Já existe um cliente com este CPF/CNPJ." });
  });

  it("creating the new one with `replacesRejected` closes the refused row in the same transaction", async () => {
    const id = await refused();
    const fresh = await createPendingCustomer(db, env, { ownerAccountId: OWNER, request: request({ name: "Padaria Corrigida" }), replacesRejected: id });
    expect(fresh.state).toBe("queued");
    expect(await getPendingCustomer(db, OWNER, id)).toBeNull();
    expect((await listPendingCustomers(db, OWNER, REAL)).map((r) => r.name)).toEqual(["Padaria Corrigida"]);
  });

  it("a failed creation leaves the refused row (and its data) untouched", async () => {
    const id = await refused();
    await create(request({ document: "98765432100" }));
    await expect(createPendingCustomer(db, env, { ownerAccountId: OWNER, request: request({ document: "98765432100" }), replacesRejected: id })).rejects.toBeInstanceOf(PendingCustomerError);
    expect(await getPendingCustomer(db, OWNER, id)).toMatchObject({ state: "rejected" });
  });

  it("only a refused row of the same account can be redone or replaced", async () => {
    const id = await refused();
    const open = await create(request({ document: "11122233396" }));
    await expect(redoPendingCustomer(db, OWNER, open.clientRequestId)).rejects.toBeInstanceOf(PendingCustomerError);
    await expect(redoPendingCustomer(db, "acct-2", id)).rejects.toBeInstanceOf(PendingCustomerError);
    await expect(createPendingCustomer(db, env, { ownerAccountId: OWNER, request: request({ document: "55544433322" }), replacesRejected: open.clientRequestId })).rejects.toBeInstanceOf(PendingCustomerError);
  });
});

describe("migration v7 over an existing database", () => {
  it("adds pending_customer on top of v6 data without touching orders", async () => {
    const old = openNodeDatabase();
    await runMigrations(old, migrations.filter((m) => m.version <= 6));
    await confirm(old);
    await old.execute(
      `INSERT INTO local_order_draft (local_id, owner_account_id, client_request_id, customer_code, customer_name, status, created_at, updated_at, dataset_environment, dataset_id, eligibility)
       VALUES ('d-old', ?, 'k-old', 5, 'Antigo', 'synced', 'a', 'a', ?, ?, 'eligible')`,
      [OWNER, REAL.environment, REAL.datasetId],
    );
    await runMigrations(old, migrations);
    expect((await old.query<{ n: number }>("SELECT count(*) AS n FROM local_order_draft"))[0]?.n).toBe(1);
    const record = await createPendingCustomer(old, env, { ownerAccountId: OWNER, request: request() });
    expect(record.state).toBe("queued");
    expect((await old.query<{ name: string }>("PRAGMA table_info(pending_customer)")).map((c) => c.name)).toContain("client_request_id");
  });

  it("local codes are never reused after a discard", async () => {
    const first = await create();
    await discardPendingCustomer(db, OWNER, first.clientRequestId);
    const second = await create();
    expect(second.localCode).toBeLessThan(first.localCode);
  });
});
