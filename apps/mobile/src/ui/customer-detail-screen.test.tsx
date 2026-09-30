import { fireEvent, render, screen } from "@testing-library/react-native";
import type { CustomerDetail, CustomerRepository } from "../data/ports";
import { customer, networkError, pageOf } from "../test-doubles";
import { CustomerDetailScreen } from "./customer-detail-screen";

const listOnly: CustomerRepository = { list: async () => pageOf([]) };

function detailOf(overrides: Partial<CustomerDetail> = {}): CustomerDetail {
  return { ...customer(10), priceTableName: null, resolvedPriceTable: null, creditLimit: null, syncedAt: "2026-09-30T12:00:00.000Z", ...overrides };
}

describe("CustomerDetailScreen", () => {
  it("shows only what a sparse customer really has: no empty sections, no invented history", async () => {
    await render(<CustomerDetailScreen customer={customer(10, { name: "Padaria Central", sellerCode: null, priceTableCode: null })} customers={listOnly} onBack={jest.fn()} onNewOrder={jest.fn()} />);
    expect(screen.getByText("Padaria Central")).toBeTruthy();
    expect(screen.getByText("Dados principais")).toBeTruthy();
    expect(screen.queryByText("Comercial")).toBeNull();
    expect(screen.queryByText("Financeiro")).toBeNull();
    expect(screen.queryByText("Documento")).toBeNull();
    expect(screen.getByText("Histórico comercial ainda não disponível neste dispositivo.")).toBeTruthy();
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
