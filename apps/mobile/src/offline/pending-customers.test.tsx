import { fireEvent, render, screen } from "@testing-library/react-native";
import { CUSTOMER_CREATION_NOT_RELEASED, TransportError, createPendingCustomer, isCustomerCreationAvailable, listPendingCustomers, readExpectedDataset, redoPendingCustomer, type OfflineEnv, type PendingCustomerRecord, type SqlDatabase } from "@salesforce/mobile-db";
import { ApiRequestError } from "../data/api";
import { describePendingBadge, PENDING_CREDIT_NOTE, PENDING_CUSTOMER_ORDER_MESSAGE } from "../data/pending-status";
import type { CustomerRepository, Repositories } from "../data/ports";
import { customer, pageOf } from "../test-doubles";
import { CustomerDetailScreen } from "../ui/customer-detail-screen";
import { CustomerPicker } from "../ui/customer-picker";
import { CustomersScreen } from "../ui/customers-screen";
import { toCustomerTransportError } from "./customer-transport";
import { createOfflineFirstRepositories } from "./offline-repositories";
import { createPendingCustomersPort, toPendingListItem } from "./pending-customers";
import { toCustomerLike } from "./customer-transport";
import { createOrderTransport } from "./transport";

jest.mock("@salesforce/mobile-db", () => ({
  ...jest.requireActual("@salesforce/mobile-db"),
  isCacheReady: jest.fn(async () => true),
  searchCustomers: jest.fn(async () => ({ items: [{ code: 5, name: "Real", tradeName: null, document: null, active: true, blocked: false, sellerCode: 7, sellerName: null, priceTableCode: null }], page: 1, pageSize: 20, total: 1 })),
  listPendingCustomers: jest.fn(),
  createPendingCustomer: jest.fn(),
  redoPendingCustomer: jest.fn(),
  isCustomerCreationAvailable: jest.fn(),
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

describe("search, filters and jumps (item 6)", () => {
  const list = listPendingCustomers as jest.MockedFunction<typeof listPendingCustomers>;
  const repos = () => createOfflineFirstRepositories({ db: {} as SqlDatabase, env, ownerAccountId: "acct-1", remote: { customers: {}, products: {}, orders: {} } as unknown as Repositories });

  it("a text search ALWAYS shows the matching pending customer on page 1", async () => {
    list.mockResolvedValue([record()]);
    const page = await repos().customers.list({ search: "padaria nova", page: 1, pageSize: 20 });
    expect(page.items[0]).toMatchObject({ code: -1, pending: expect.anything() });
  });

  it.each([
    ["seller filter", { filters: { sellerCode: 7 } }],
    ["price-table filter", { filters: { hasPriceTable: true } }],
    ["letter jump", { startAt: 5 }],
  ])("disappears with a %s", async (_name, extra) => {
    list.mockResolvedValue([record()]);
    const page = await repos().customers.list({ search: "", page: 1, pageSize: 20, ...extra });
    expect(page.items.some((item) => item.pending !== undefined)).toBe(false);
  });
});

describe("the negative local code is never shown as a real code", () => {
  const pendingItem = toPendingListItem(record({ localCode: -7, state: "awaiting_erp" }));

  it("not in the list, the sheet or the picker", async () => {
    const repo: CustomerRepository = { list: async () => pageOf([pendingItem], 1) };
    const { unmount } = await render(<CustomersScreen customers={repo} onUnauthenticated={noop} />);
    await screen.findByText("Padaria Nova");
    expect(screen.queryByText(/-7/)).toBeNull();
    expect(screen.queryByText(/Código/)).toBeNull();
    expect(screen.queryByLabelText(/código -7/i)).toBeNull();
    await unmount();
    await render(<CustomerDetailScreen customer={pendingItem} customers={repo} onBack={noop} onNewOrder={noop} />);
    expect(screen.queryByText(/-7/)).toBeNull();
    expect(screen.queryByText(/Código/)).toBeNull();
    expect(screen.queryByLabelText(/Código/)).toBeNull();
  });

  it("the order transport refuses a negative customer code without calling the server", async () => {
    const post = jest.fn();
    const transport = createOrderTransport({ POST: post } as never);
    await expect(
      transport.createOrder("k", { customerCode: -7, negotiationTypeCode: null, notes: null, items: [] } as never, { environment: "production", datasetId: "d1" }),
    ).rejects.toBeInstanceOf(TransportError);
    expect(post).not.toHaveBeenCalled();
  });
});

describe("a customer the ERP confirmed but whose data is still being read", () => {
  const item = toPendingListItem(record({ localCode: -3, state: "confirmed", customerCode: 4321 }));

  it("is listed and opened under its REAL code and can receive an order", async () => {
    expect(item.code).toBe(4321);
    const onNewOrder = jest.fn();
    const onSelect = jest.fn();
    const repo: CustomerRepository = { list: async () => pageOf([item], 1) };
    await render(<CustomerDetailScreen customer={item} customers={repo} onBack={noop} onNewOrder={onNewOrder} />);
    expect(screen.getByText("Confirmado no Sankhya — carregando dados")).toBeTruthy();
    expect(screen.queryByText(PENDING_CUSTOMER_ORDER_MESSAGE)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Novo pedido" }));
    expect(onNewOrder).toHaveBeenCalledWith(item);
    await render(<CustomerPicker customers={repo} onSelect={onSelect} onUnauthenticated={noop} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Selecionar cliente Padaria Nova" }));
    expect(onSelect).toHaveBeenCalledWith(item);
  });
});

describe("not released (customer_write_disabled)", () => {
  it("the badge says so, in the seller's words", () => {
    const item = toPendingListItem(record({ lastError: CUSTOMER_CREATION_NOT_RELEASED }));
    expect(describePendingBadge(item.pending)).toBe("Cadastro de cliente ainda não liberado, vamos tentar de novo");
  });
});

describe("Refazer on a refused customer's sheet", () => {
  const rejected = toPendingListItem(record({ state: "rejected", rejectionReason: "Já existe um cliente com este CPF/CNPJ." }));
  const repo: CustomerRepository = { list: async () => pageOf([rejected], 1) };

  it("shows the button and hands the customer to the form", async () => {
    const onRedo = jest.fn();
    await render(<CustomerDetailScreen customer={rejected} customers={repo} onBack={noop} onNewOrder={noop} onRedo={onRedo} />);
    await fireEvent.press(screen.getByRole("button", { name: "Refazer" }));
    expect(onRedo).toHaveBeenCalledWith(rejected);
  });

  it("is not offered for a customer that was not refused", async () => {
    await render(<CustomerDetailScreen customer={toPendingListItem(record())} customers={repo} onBack={noop} onNewOrder={noop} onRedo={jest.fn()} />);
    expect(screen.queryByRole("button", { name: "Refazer" })).toBeNull();
  });
});

describe("PendingCustomersPort", () => {
  const port = (onChanged = jest.fn()) => createPendingCustomersPort({ db: {} as SqlDatabase, env, ownerAccountId: "acct-1", onChanged });

  it("exposes whether creating customers is available, from the last server answer", async () => {
    (isCustomerCreationAvailable as jest.Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await port().creationAvailable()).toBe(false);
    expect(await port().creationAvailable()).toBe(true);
  });

  it("redo returns what was typed and creating the new one closes the refused row", async () => {
    const typed = { document: "12345678909", name: "X" };
    (redoPendingCustomer as jest.Mock).mockResolvedValue(typed);
    (createPendingCustomer as jest.Mock).mockResolvedValue(record());
    const onChanged = jest.fn();
    const p = port(onChanged);
    expect(await p.redo("req-1")).toBe(typed);
    expect(onChanged).not.toHaveBeenCalled();
    await p.create({ document: "1" } as never, { redoOf: "req-1" });
    expect(createPendingCustomer).toHaveBeenCalledWith(expect.anything(), env, { ownerAccountId: "acct-1", request: { document: "1" }, replacesRejected: "req-1" });
    expect(onChanged).toHaveBeenCalled();
  });
});

describe("GET /customers/{code} -> the cached shape", () => {
  it("keeps the list fields only: no credit limit, table name or sync stamp", () => {
    const like = toCustomerLike({
      code: 4321, name: "N", tradeName: null, document: "1", active: true, blocked: false, sellerCode: 7, sellerName: "A", priceTableCode: 3,
      priceTableName: "Atacado", resolvedPriceTable: null, creditLimit: "100.00", monthlyCreditLimit: "10.00", syncedAt: "2026-11-13T00:00:00.000Z",
    } as never);
    expect(Object.keys(like).sort()).toEqual(["active", "blocked", "code", "document", "name", "priceTableCode", "sellerCode", "sellerName", "tradeName"]);
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
