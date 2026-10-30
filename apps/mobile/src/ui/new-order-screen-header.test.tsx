import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { customer, draftRecord, fakeLocalOrders, fakeOrders, fakeProducts, orderEntryConfiguration, pageOf, product } from "../test-doubles";
import { NewOrderScreen } from "./new-order-screen";

async function pressAndSettle(element: unknown, delayMs = 100) {
  await act(async () => {
    fireEvent.press(element as never);
    await new Promise<void>((resolve) => setTimeout(() => resolve(), delayMs));
  });
}
afterEach(async () => {
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 400));
});

const copo = product(5, { description: "Copo 200 ml", listPrice: { state: "priced", unitPrice: "10.00", tableCode: 1, versionId: 1 } });
const base = orderEntryConfiguration();
const config = orderEntryConfiguration({
  sales: {
    ...base.sales,
    defaultNegotiationTypeCode: 1,
    negotiationTypes: [
      { code: 1, label: "À vista", sellable: true },
      { code: 2, label: "Antigo", sellable: false },
      { code: 3, label: "30 dias" },
    ],
    orderTops: { defaultTopCode: 1001, quotationTopCode: 1000, eligibleTopCodes: [1000, 1001] },
  },
});

async function openCart(localOrders = fakeLocalOrders(), carriers: readonly { code: number; name: string }[] = []) {
  const repositories = {
    customers: { list: async () => pageOf([customer(10, { name: "Padaria Central" })]) },
    products: fakeProducts({ list: async () => pageOf([copo]) }),
    orders: fakeOrders({ getEntryConfiguration: async () => config, listCarriers: async () => carriers }),
  };
  await render(<NewOrderScreen repositories={repositories} onUnauthenticated={() => undefined} localOrders={localOrders} />);
  await pressAndSettle(await screen.findByText("Padaria Central"));
  await pressAndSettle(screen.getByRole("button", { name: "Adicionar Copo 200 ml ao carrinho" }));
  await pressAndSettle(screen.getByRole("tab", { name: "Carrinho (1)" }));
}

describe("NewOrderScreen order options (D-A, D-B)", () => {
  it("offers the TOPs and only the sellable negotiation types", async () => {
    await openCart();
    expect(screen.getByRole("radio", { name: "Operação Pedido (TOP 1001)" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Operação Cotação (TOP 1000)" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Negociação À vista" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Negociação 30 dias" })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Negociação Antigo" })).toBeNull();
  });

  it("saves the chosen TOP and negotiation type on the local draft", async () => {
    const save = jest.fn(async (input: { negotiationTypeCode: number | null }) => draftRecord({ negotiationTypeCode: input.negotiationTypeCode }));
    await openCart(fakeLocalOrders([], { save: save as never }));
    await pressAndSettle(screen.getByRole("radio", { name: "Operação Cotação (TOP 1000)" }));
    await pressAndSettle(screen.getByRole("radio", { name: "Negociação 30 dias" }));
    await pressAndSettle(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ topCode: 1000, negotiationTypeCode: 3, carrierCode: null }));
  });

  it("sends no TOP when none was chosen, leaving the default to the server", async () => {
    const save = jest.fn(async () => draftRecord());
    await openCart(fakeLocalOrders([], { save: save as never }));
    await pressAndSettle(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ topCode: null, negotiationTypeCode: 1 }));
  });

  it("saves the chosen carrier, and 'Nenhuma' clears it", async () => {
    const save = jest.fn(async () => draftRecord());
    await openCart(fakeLocalOrders([], { save: save as never }), [{ code: 7, name: "Rápido" }]);
    await pressAndSettle(screen.getByRole("button", { name: "Escolher transportadora" }));
    await pressAndSettle(screen.getByRole("button", { name: "Transportadora Rápido" }));
    await pressAndSettle(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ carrierCode: 7 }));
  });

  it("degrades gracefully when no carrier list is available", async () => {
    await openCart();
    expect(screen.getByText(/lista de transportadoras não está disponível/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Escolher transportadora" }).props.accessibilityState?.disabled).toBe(true);
  });
});
