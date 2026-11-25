import { fireEvent, render, screen } from "@testing-library/react-native";
import type { CustomerDetail, CustomerRepository } from "../data/ports";
import { customer, draftRecord, fakeLocalOrders, networkError, pageOf } from "../test-doubles";
import type { CustomerFinancial } from "../data/ports";
import { CustomerDetailScreen } from "./customer-detail-screen";

const listOnly: CustomerRepository = { list: async () => pageOf([]) };

function detailOf(overrides: Partial<CustomerDetail> = {}): CustomerDetail {
  return { ...customer(10), priceTableName: null, resolvedPriceTable: null, creditLimit: null, monthlyCreditLimit: null, syncedAt: "2026-09-30T12:00:00.000Z", ...overrides };
}

describe("CustomerDetailScreen", () => {
  it("shows only what a sparse customer really has: no empty sections, no invented history", async () => {
    await render(<CustomerDetailScreen customer={customer(10, { name: "Padaria Central", sellerCode: null, priceTableCode: null })} customers={listOnly} onBack={jest.fn()} onNewOrder={jest.fn()} />);
    expect(screen.getByText("Padaria Central")).toBeTruthy();
    expect(screen.getByText("Dados principais")).toBeTruthy();
    expect(screen.queryByText("Comercial")).toBeNull();
    expect(screen.queryByText("Financeiro")).toBeNull();
    expect(screen.queryByText("Documento")).toBeNull();
    expect(screen.queryByRole("button", { name: /Ligar|E-mail|WhatsApp/ })).toBeNull();
  });

  it("shows the cached commercial data and enriches it with the online detail (price table name, credit limit)", async () => {
    const full = customer(10, { name: "Padaria Central", tradeName: "Padoca", document: "12345678000190", sellerCode: 7, sellerName: "Ana", priceTableCode: 3 });
    const customers: CustomerRepository = { ...listOnly, get: async () => detailOf({ ...full, priceTableName: "Atacado", creditLimit: "12500.5" }) };
    await render(<CustomerDetailScreen customer={full} customers={customers} connectivity="online" onBack={jest.fn()} onNewOrder={jest.fn()} />);
    expect(screen.getByText("Padoca")).toBeTruthy();
    expect(screen.getByLabelText("Documento: 12345678000190")).toBeTruthy();
    expect(screen.getByLabelText("Vendedor: Ana")).toBeTruthy();
    expect(await screen.findByLabelText("Tabela de preço: Atacado (3)")).toBeTruthy();
    expect(screen.getByLabelText("Limite de crédito: R$ 12.500,50")).toBeTruthy();
  });

  it("opens offline from the device data without asking the server", async () => {
    const get = jest.fn(async () => detailOf());
    await render(
      <CustomerDetailScreen customer={customer(10, { name: "Mercado Sul", priceTableCode: 3 })} customers={{ ...listOnly, get }} connectivity="offline" onBack={jest.fn()} onNewOrder={jest.fn()} />,
    );
    expect(screen.getByText("Mercado Sul")).toBeTruthy();
    expect(screen.getByLabelText("Tabela de preço: 3")).toBeTruthy();
    expect(screen.getByText("Sem conexão: dados salvos neste aparelho.")).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
  });

  it("stays complete when the online detail fails", async () => {
    const get = jest.fn(async () => {
      throw networkError();
    });
    await render(<CustomerDetailScreen customer={customer(10, { name: "Mercado Sul" })} customers={{ ...listOnly, get }} onBack={jest.fn()} onNewOrder={jest.fn()} />);
    expect(screen.getByText("Mercado Sul")).toBeTruthy();
    expect(screen.queryByText("Financeiro")).toBeNull();
  });

  it("a customer without a seller cannot start an order from the sheet either (owner 2026-11-13)", async () => {
    const onNewOrder = jest.fn();
    await render(<CustomerDetailScreen customer={customer(10, { name: "Sem dono", sellerCode: null })} customers={listOnly} onBack={jest.fn()} onNewOrder={onNewOrder} />);
    expect(screen.getByText("Cliente sem vendedor. Peça ao backoffice para atribuir.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Novo pedido" }));
    expect(onNewOrder).not.toHaveBeenCalled();
  });

  it("goes back and starts a new order for this customer", async () => {
    const onBack = jest.fn();
    const onNewOrder = jest.fn();
    const target = customer(10, { name: "Padaria Central" });
    await render(<CustomerDetailScreen customer={target} customers={listOnly} onBack={onBack} onNewOrder={onNewOrder} />);
    await fireEvent.press(screen.getByRole("button", { name: "Novo pedido" }));
    expect(onNewOrder).toHaveBeenCalledWith(target);
    await fireEvent.press(screen.getByRole("button", { name: "Voltar para Clientes" }));
    expect(onBack).toHaveBeenCalled();
  });

  // BUSINESS_RULE_UNDEFINED: no approved rule says a blocked/inactive customer cannot start an order, so the
  // ficha only reports the real status and leaves the decision to the server.
  it.each([
    ["blocked", { blocked: true }, "Bloqueado"],
    ["inactive", { active: false }, "Inativo"],
  ] as const)("shows the %s status but does not invent a commercial block on Novo pedido", async (_name, overrides, label) => {
    const onNewOrder = jest.fn();
    const target = customer(10, overrides);
    await render(<CustomerDetailScreen customer={target} customers={listOnly} onBack={jest.fn()} onNewOrder={onNewOrder} />);
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText(/não é possível iniciar um pedido/)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Novo pedido" }));
    expect(onNewOrder).toHaveBeenCalledWith(target);
  });
});

describe("CustomerDetailScreen: financeiro, pedidos do cliente e repetir último pedido", () => {
  const financial: CustomerFinancial = {
    customerCode: 10,
    creditLimit: "5000",
    monthlyCreditLimit: null,
    blocked: false,
    blockReason: null,
    situation: null,
    summary: { openCount: 2, openAmount: "300.5", overdueCount: 1, overdueAmount: "100", oldestOverdueDueDate: "2026-10-01" },
    titles: [{ nufin: 1, documentNumber: 77, dueDate: "2026-10-01", amount: "100", balance: "100", overdue: true }, { nufin: 2, documentNumber: null, dueDate: "2026-12-01", amount: "200.5", balance: "200.5", overdue: false }],
    checkedAt: "2026-11-25T10:00:00.000Z",
  };

  it("shows the open titles and the summary exactly as the server delivered them, only online", async () => {
    const customers: CustomerRepository = { ...listOnly, financial: async () => financial };
    await render(<CustomerDetailScreen customer={customer(10)} customers={customers} connectivity="online" onBack={jest.fn()} onNewOrder={jest.fn()} />);
    expect(await screen.findByLabelText("Em aberto: 2 títulos · R$ 300,50")).toBeTruthy();
    expect(screen.getByLabelText("Vencido: 1 título · R$ 100,00")).toBeTruthy();
    expect(screen.getByLabelText("Limite de crédito: R$ 5.000,00")).toBeTruthy();
    expect(screen.getByLabelText("Bloqueio: Sem bloqueio")).toBeTruthy();
    expect(screen.getByLabelText("Título com vencimento em 01/10/2026, vencido, saldo R$ 100,00")).toBeTruthy();
    expect(screen.getByLabelText("Título com vencimento em 01/12/2026, saldo R$ 200,50")).toBeTruthy();
  });

  it("offline or without the financial area (404 = null) there is no Financeiro section and no request", async () => {
    const financialRead = jest.fn(async () => financial);
    await render(<CustomerDetailScreen customer={customer(10)} customers={{ ...listOnly, financial: financialRead }} connectivity="offline" onBack={jest.fn()} onNewOrder={jest.fn()} />);
    expect(financialRead).not.toHaveBeenCalled();
    expect(screen.queryByText("Financeiro")).toBeNull();
  });

  it("lists the customer's orders from the device and repeats the last recorded one", async () => {
    const recorded = draftRecord({ localId: "s1", customerCode: 10, customerName: "Cliente 10", status: "synced", remoteId: "r-1", sendState: "submitted", sendCode: "sent", updatedAt: "2026-11-20T10:00:00.000Z" });
    const saved = draftRecord({ localId: "s2", customerCode: 10, customerName: "Cliente 10", status: "local_only", updatedAt: "2026-11-24T10:00:00.000Z" });
    const other = draftRecord({ localId: "s3", customerCode: 99, customerName: "Outro", status: "synced", remoteId: "r-3", sendState: "submitted", sendCode: "sent" });
    const onRepeatLast = jest.fn();
    await render(<CustomerDetailScreen customer={customer(10)} customers={listOnly} localOrders={fakeLocalOrders([recorded, saved, other])} onRepeatLast={onRepeatLast} onBack={jest.fn()} onNewOrder={jest.fn()} />);
    expect(await screen.findByText("Pedidos do cliente")).toBeTruthy();
    expect(screen.getAllByLabelText(/^Pedido de /).length).toBe(2);
    await fireEvent.press(screen.getByRole("button", { name: "Repetir último pedido" }));
    // The order only saved on the device was never recorded in the Force: the repeat uses the recorded one.
    expect(onRepeatLast).toHaveBeenCalledWith("s1");
  });

  it("without any recorded order there is no Repetir último pedido", async () => {
    const saved = draftRecord({ localId: "s2", customerCode: 10, customerName: "Cliente 10", status: "local_only" });
    await render(<CustomerDetailScreen customer={customer(10)} customers={listOnly} localOrders={fakeLocalOrders([saved])} onRepeatLast={jest.fn()} onBack={jest.fn()} onNewOrder={jest.fn()} />);
    expect(await screen.findByText("Pedidos do cliente")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Repetir último pedido" })).toBeNull();
  });
});
