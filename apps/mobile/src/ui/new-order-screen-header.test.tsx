import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { customer, draftRecord, fakeLocalOrders, fakeOrders, fakeProducts, orderEntryConfiguration, pageOf, product } from "../test-doubles";
import { NewOrderScreen } from "./new-order-screen";
import { fillMandatoryHeader } from "./fill-mandatory-header";

async function pressAndSettle(element: unknown, delayMs = 100) {
  await act(async () => {
    fireEvent.press(element as never);
    await new Promise<void>((resolve) => setTimeout(() => resolve(), delayMs));
  });
}

// The save button lives on the summary step: from the cart, "Avançar" gets there (already there when editing).
async function saveFromSummary(name: string) {
  const next = screen.queryByRole("button", { name: "Avançar" });
  if (next !== null) await pressAndSettle(next);
  // Moving between steps auto-saves a local draft, after which the same button reads "Salvar alterações".
  const button = screen.queryByRole("button", { name }) ?? screen.getByRole("button", { name: name === "Salvar rascunho" ? "Salvar alterações" : "Salvar rascunho" });
  await pressAndSettle(button);
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

async function openCart(localOrders = fakeLocalOrders(), carriers: readonly { code: number; name: string }[] = [{ code: 7, name: "Transportes Alfa" }], onNegotiation?: () => Promise<void>) {
  const repositories = {
    customers: { list: async () => pageOf([customer(10, { name: "Padaria Central" })]) },
    products: fakeProducts({ list: async () => pageOf([copo]) }),
    orders: fakeOrders({ getEntryConfiguration: async () => config, listCarriers: async () => carriers }),
  };
  await render(<NewOrderScreen repositories={repositories} onUnauthenticated={() => undefined} localOrders={localOrders} />);
  await pressAndSettle(await screen.findByText("Padaria Central"));
  await pressAndSettle(screen.getByRole("button", { name: "Avançar" }));
  if (onNegotiation) await onNegotiation();
  await fillMandatoryHeader();
  await pressAndSettle(screen.getByRole("button", { name: "Avançar" }));
  await pressAndSettle(screen.getByRole("button", { name: "Adicionar Copo 200 ml ao carrinho" }));
  await pressAndSettle(screen.getByRole("tab", { name: "Carrinho (1)" }));
}

describe("NewOrderScreen order options (D-A, D-B)", () => {
  it("offers the TOPs and only the sellable negotiation types", async () => {
    await openCart(fakeLocalOrders(), undefined, async () => {
      expect(screen.getByRole("radio", { name: "Operação Pedido (TOP 1001)" })).toBeTruthy();
      expect(screen.getByRole("radio", { name: "Operação Orçamento (TOP 1000)" })).toBeTruthy();
      expect(screen.getByRole("radio", { name: "Negociação À vista" })).toBeTruthy();
      expect(screen.getByRole("radio", { name: "Negociação 30 dias" })).toBeTruthy();
      expect(screen.queryByRole("radio", { name: "Negociação Antigo" })).toBeNull();
    });
  });

  it("saves the chosen TOP and negotiation type on the local draft", async () => {
    const save = jest.fn(async (input: { negotiationTypeCode: number | null }) => draftRecord({ negotiationTypeCode: input.negotiationTypeCode }));
    await openCart(fakeLocalOrders([], { save: save as never }), undefined, async () => {
      await pressAndSettle(screen.getByRole("radio", { name: "Operação Orçamento (TOP 1000)" }));
      await pressAndSettle(screen.getByRole("radio", { name: "Negociação 30 dias" }));
    });
    await saveFromSummary("Salvar rascunho");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ topCode: 1000, negotiationTypeCode: 3, carrierCode: 7 }));
  });

  it("saves the header chosen on the mandatory step (nothing is preselected)", async () => {
    const save = jest.fn(async () => draftRecord());
    await openCart(fakeLocalOrders([], { save: save as never }));
    await saveFromSummary("Salvar rascunho");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ negotiationTypeCode: 1, freightType: "CIF", carrierCode: 7 }));
  });

  it("saves the chosen carrier; the sheet offers real carriers only, no 'Nenhuma'", async () => {
    const save = jest.fn(async () => draftRecord());
    await openCart(fakeLocalOrders([], { save: save as never }), [{ code: 9, name: "Rápido" }], async () => {
      await pressAndSettle(screen.getByRole("button", { name: "Escolher transportadora" }));
      expect(screen.queryByText("Nenhuma")).toBeNull();
      await pressAndSettle(screen.getByRole("button", { name: "Transportadora Rápido" }));
    });
    await saveFromSummary("Salvar rascunho");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ carrierCode: 9 }));
  });

  it("blocks Avançar on the negotiation step and lists exactly what is missing", async () => {
    const repositories = {
      customers: { list: async () => pageOf([customer(10, { name: "Padaria Central" })]) },
      products: fakeProducts({ list: async () => pageOf([copo]) }),
      orders: fakeOrders({ getEntryConfiguration: async () => config, listCarriers: async () => [] }),
    };
    await render(<NewOrderScreen repositories={repositories} onUnauthenticated={() => undefined} localOrders={fakeLocalOrders()} />);
    await pressAndSettle(await screen.findByText("Padaria Central"));
    await pressAndSettle(screen.getByRole("button", { name: "Avançar" }));
    expect(screen.getByText(/lista de transportadoras não está disponível/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Escolher transportadora" }).props.accessibilityState?.disabled).toBe(true);
    await pressAndSettle(screen.getByRole("button", { name: "Avançar" }));
    expect(screen.getByText(/Preencha para continuar:.*Tipo de negociação.*Frete.*Transportadora/)).toBeTruthy();
    expect(screen.getByLabelText("Etapa 2 de 4: Negociação")).toBeTruthy();
  });
});
