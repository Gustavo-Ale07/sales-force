import { fireEvent, render, screen } from "@testing-library/react-native";
import { TransportError, listPendingCustomers, readExpectedDataset, type OfflineEnv, type PendingCustomerRecord, type SqlDatabase } from "@salesforce/mobile-db";
import { ApiRequestError } from "../data/api";
import { describePendingBadge, PENDING_CREDIT_NOTE, PENDING_CUSTOMER_ORDER_MESSAGE } from "../data/pending-status";
import type { CustomerRepository, Repositories } from "../data/ports";
import { customer, pageOf } from "../test-doubles";
import { CustomerDetailScreen } from "../ui/customer-detail-screen";
import { CustomerPicker } from "../ui/customer-picker";
import { CustomersScreen } from "../ui/customers-screen";
import { toCustomerTransportError } from "./customer-transport";
import { createOfflineFirstRepositories } from "./offline-repositories";
import { toPendingListItem } from "./pending-customers";

jest.mock("@salesforce/mobile-db", () => ({
  ...jest.requireActual("@salesforce/mobile-db"),
  isCacheReady: jest.fn(async () => true),
  searchCustomers: jest.fn(async () => ({ items: [{ code: 5, name: "Real", tradeName: null, document: null, active: true, blocked: false, sellerCode: 7, sellerName: null, priceTableCode: null }], page: 1, pageSize: 20, total: 1 })),
  listPendingCustomers: jest.fn(),
  readExpectedDataset: jest.fn(async () => ({ environment: "production", datasetId: "d1" })),
}));

const noop = () => undefined;
const env = { now: () => new Date("2026-11-13T12:00:00Z"), newId: () => "x" } as unknown as OfflineEnv;

function record(over: Partial<PendingCustomerRecord> = {}): PendingCustomerRecord {
  return {
    localCode: -1,
    clientRequestId: "req-1",
    ownerAccountId: "acct-1",
    name: "Padaria Nova",
    document: "12345678909",
    maskedDocument: "***.456.789-**",
    request: { tradeName: "Padoca" },
    state: "queued",
    registrationId: null,
    customerCode: null,
    rejectionReason: null,
    lastError: null,
    attempts: 0,
    nextAttemptAt: null,
    createdAt: "a",
    updatedAt: "a",
    dataset: { environment: "production", datasetId: "d1" },
    ...over,
  } as unknown as PendingCustomerRecord;
}

describe("badge text", () => {
  it.each([
    ["queued", null, "Aguardando envio ao Sankhya"],
    ["sending", null, "Aguardando envio ao Sankhya"],
    ["awaiting_erp", null, "Aguardando confirmação"],
    ["rejected", "Já existe um cliente com este CPF/CNPJ.", "Não aceito: Já existe um cliente com este CPF/CNPJ."],
  ] as const)("%s", (state, rejectionReason, text) => {
    expect(describePendingBadge({ clientRequestId: "r", state, rejectionReason })).toBe(text);
  });
  it("is absent for a normal customer", () => expect(describePendingBadge(undefined)).toBeNull());
});

describe("offline-first customer list with pending customers", () => {
  const list = listPendingCustomers as jest.MockedFunction<typeof listPendingCustomers>;
  const repos = () => createOfflineFirstRepositories({ db: {} as SqlDatabase, env, ownerAccountId: "acct-1", remote: { customers: {}, products: {}, orders: {} } as unknown as Repositories });

  it("shows the pending customer first on page 1, without waiting for a sync, and counts it", async () => {
    list.mockResolvedValue([record()]);
    const page = await repos().customers.list({ search: "", page: 1, pageSize: 20 });
    expect(page.items.map((i) => i.code)).toEqual([-1, 5]);
    expect(page.total).toBe(2);
    expect(page.items[0]).toMatchObject({ document: "***.456.789-**", priceTableCode: null, sellerCode: null, pending: { state: "queued" } });
    expect(list).toHaveBeenCalledWith(expect.anything(), "acct-1", expect.anything(), "");
  });

  it("passes the search text so the name finds it", async () => {
    list.mockResolvedValue([]);
    await repos().customers.list({ search: "padaria", page: 1, pageSize: 20 });
    expect(list).toHaveBeenLastCalledWith(expect.anything(), "acct-1", expect.anything(), "padaria");
  });

  it("does not repeat it on page 2, nor when a seller / price-table filter or a letter jump is active", async () => {
    list.mockResolvedValue([record()]);
    expect((await repos().customers.list({ search: "", page: 2, pageSize: 20 })).items.map((i) => i.code)).toEqual([5]);
    expect((await repos().customers.list({ search: "", page: 1, pageSize: 20, filters: { sellerCode: 7 } })).items.map((i) => i.code)).toEqual([5]);
    expect((await repos().customers.list({ search: "", page: 1, pageSize: 20, startAt: 3 })).items.map((i) => i.code)).toEqual([5]);
  });

  it("never asks the server for the detail of a local customer", async () => {
    const get = jest.fn();
    const r = createOfflineFirstRepositories({ db: {} as SqlDatabase, env, ownerAccountId: "acct-1", remote: { customers: { get }, products: {}, orders: {} } as unknown as Repositories });
    await expect(r.customers.get?.(-1)).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
    expect(readExpectedDataset).toBeDefined();
  });

  it("maps a record to a list item without cost, credit or table", () => {
    const item = toPendingListItem(record({ state: "rejected", rejectionReason: "x" }));
    expect(Object.keys(item).sort()).toEqual(["active", "blocked", "code", "document", "name", "pending", "priceTableCode", "sellerCode", "sellerName", "tradeName"]);
  });
});

describe("screens", () => {
  const pendingItem = toPendingListItem(record());
  const repo: CustomerRepository = { list: async () => pageOf([pendingItem], 1) };

  it("lists the pending customer with the badge, name and masked document", async () => {
    await render(<CustomersScreen customers={repo} onUnauthenticated={noop} />);
    expect(await screen.findByText("Padaria Nova")).toBeTruthy();
    expect(screen.getByText("Aguardando envio ao Sankhya")).toBeTruthy();
    expect(screen.getByText("***.456.789-**")).toBeTruthy();
  });

  it("the sheet states the credit note, shows no credit limit or table and refuses a new order", async () => {
    const onNewOrder = jest.fn();
    const get = jest.fn();
    await render(<CustomerDetailScreen customer={pendingItem} customers={{ ...repo, get }} connectivity="online" onBack={noop} onNewOrder={onNewOrder} />);
    expect(screen.getByText("Aguardando envio ao Sankhya")).toBeTruthy();
    expect(screen.getByText(PENDING_CREDIT_NOTE)).toBeTruthy();
    expect(screen.queryByText(/Tabela de preço|Limite de crédito:/)).toBeNull();
    expect(screen.getByText(PENDING_CUSTOMER_ORDER_MESSAGE)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Novo pedido" }));
    expect(onNewOrder).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("a rejected customer shows the reason", async () => {
    const rejected = toPendingListItem(record({ state: "rejected", rejectionReason: "O Sankhya recusou o cadastro do cliente. Confira os dados." }));
    await render(<CustomersScreen customers={{ list: async () => pageOf([rejected], 1) }} onUnauthenticated={noop} />);
    expect(await screen.findByText("Não aceito: O Sankhya recusou o cadastro do cliente. Confira os dados.")).toBeTruthy();
  });

  it("the order picker cannot choose it, even where blocked customers are allowed", async () => {
    const onSelect = jest.fn();
    const withNormal: CustomerRepository = { list: async () => pageOf([pendingItem, customer(5, { name: "Real" })], 2) };
    await render(<CustomerPicker customers={withNormal} onSelect={onSelect} onUnauthenticated={noop} allowUnavailable />);
    await fireEvent.press(await screen.findByRole("button", { name: "Selecionar cliente Padaria Nova" }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText(PENDING_CUSTOMER_ORDER_MESSAGE)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Selecionar cliente Real" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("customer transport error mapping", () => {
  const api = (status: number, extra: { code?: string; reason?: string; message?: string } = {}) => new ApiRequestError({ status, message: extra.message ?? "x", ...extra });

  it("409 refusals are permanent registration refusals", () => {
    for (const reason of ["document_already_registered", "customer_rejected"]) {
      const error = toCustomerTransportError(api(409, { reason }));
      expect(error).toBeInstanceOf(TransportError);
      expect(error).toMatchObject({ kind: "registration_refused", reason });
    }
  });
  it("customer_write_disabled is transient (server), not a refusal", () => {
    expect(toCustomerTransportError(api(409, { reason: "customer_write_disabled" }))).toMatchObject({ kind: "server", reason: "customer_write_disabled" });
  });
  it("idempotency conflict keeps its class", () => {
    expect(toCustomerTransportError(api(409, { code: "idempotency_conflict" }))).toMatchObject({ kind: "idempotency_conflict" });
  });
  it.each([
    [0, "network"],
    [401, "auth"],
    [429, "rate_limit"],
    [503, "server"],
    [400, "validation"],
    [403, "validation"],
  ] as const)("status %s -> %s", (status, kind) => {
    expect(toCustomerTransportError(api(status))).toMatchObject({ kind });
  });
});
