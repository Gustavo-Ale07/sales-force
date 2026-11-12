import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { customer, draftRecord, fakeLocalOrders, fakeOrders, fakeProducts, pageOf, product } from "../test-doubles";
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

async function open(localOrders = fakeLocalOrders()) {
  const repositories = {
    customers: { list: async () => pageOf([customer(10, { name: "Padaria Central" })]) },
    products: fakeProducts({ list: async () => pageOf([copo]) }),
    orders: fakeOrders(),
  };
  await render(<NewOrderScreen repositories={repositories} onUnauthenticated={() => undefined} localOrders={localOrders} />);
}

const next = () => screen.getByRole("button", { name: "Avançar" });

describe("NewOrderScreen as a 4-step wizard", () => {
  it("starts on step 1 of 4 and cannot advance without a customer", async () => {
    await open();
    expect(screen.getByLabelText("Etapa 1 de 4: Cliente")).toBeTruthy();
    await screen.findByText("Padaria Central");
    await pressAndSettle(next());
    expect(screen.getByText("Selecione um cliente para continuar.")).toBeTruthy();
    expect(screen.getByLabelText("Etapa 1 de 4: Cliente")).toBeTruthy();
  });

  it("walks Cliente → Negociação → Produtos and refuses an empty cart with a clear message", async () => {
    await open();
    await pressAndSettle(await screen.findByText("Padaria Central"));
    await pressAndSettle(next());
    expect(screen.getByLabelText("Etapa 2 de 4: Negociação")).toBeTruthy();
    await pressAndSettle(next());
    expect(screen.getByLabelText("Etapa 3 de 4: Produtos")).toBeTruthy();
    await pressAndSettle(next());
    expect(screen.getByText("Adicione ao menos um produto para continuar.")).toBeTruthy();
    expect(screen.getByLabelText("Etapa 3 de 4: Produtos")).toBeTruthy();
  });

  it("goes back with Voltar, one step at a time", async () => {
    await open();
    await pressAndSettle(await screen.findByText("Padaria Central"));
    await pressAndSettle(next());
    await pressAndSettle(screen.getByRole("button", { name: "Voltar" }));
    expect(screen.getByLabelText("Etapa 1 de 4: Cliente")).toBeTruthy();
  });

  async function toSummary(localOrders = fakeLocalOrders()) {
    await open(localOrders);
    await pressAndSettle(await screen.findByText("Padaria Central"));
    await pressAndSettle(next());
    await pressAndSettle(next());
    await pressAndSettle(await screen.findByRole("button", { name: "Adicionar Copo 200 ml ao carrinho" }));
    await pressAndSettle(next());
    expect(screen.getByLabelText("Etapa 4 de 4: Resumo")).toBeTruthy();
  }

  it("shows the summary with the items and lets each block jump back to its own step", async () => {
    await toSummary();
    expect(screen.getByText("Copo 200 ml")).toBeTruthy();

    await pressAndSettle(screen.getByRole("button", { name: "Editar negociação" }));
    expect(screen.getByLabelText("Etapa 2 de 4: Negociação")).toBeTruthy();
    await pressAndSettle(next());
    await pressAndSettle(next());
    await pressAndSettle(screen.getByRole("button", { name: "Editar cliente" }));
    expect(screen.getByLabelText("Etapa 1 de 4: Cliente")).toBeTruthy();
  });

  it("includes the notes typed on the negotiation step in the saved order", async () => {
    const save = jest.fn(async () => draftRecord());
    await open(fakeLocalOrders([], { save: save as never }));
    await pressAndSettle(await screen.findByText("Padaria Central"));
    await pressAndSettle(next());
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText("Observações do pedido"), "Entregar pela manhã");
    });
    await pressAndSettle(next());
    await pressAndSettle(await screen.findByRole("button", { name: "Adicionar Copo 200 ml ao carrinho" }));
    await pressAndSettle(next());
    await pressAndSettle(screen.getByRole("button", { name: /^Salvar (rascunho|alterações)$/ }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ notes: "Entregar pela manhã" }));
  });

  it("auto-saves a local draft when moving between steps, without pressing save", async () => {
    const save = jest.fn(async () => draftRecord());
    await toSummary(fakeLocalOrders([], { save: save as never }));
    expect(save).toHaveBeenCalled();
  });

  it("does not auto-save while there is nothing to save yet", async () => {
    const save = jest.fn(async () => draftRecord());
    await open(fakeLocalOrders([], { save: save as never }));
    await pressAndSettle(await screen.findByText("Padaria Central"));
    await pressAndSettle(next());
    await pressAndSettle(next());
    expect(save).not.toHaveBeenCalled();
  });
});
