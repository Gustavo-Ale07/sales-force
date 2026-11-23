import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { customer, fakeOrders, fakeProducts, pageOf, product } from "../test-doubles";
import { NewOrderScreen, type NewOrderScreenProps } from "./new-order-screen";
import { withModal } from "../test-render";
import { fillMandatoryHeader } from "./fill-mandatory-header";

// Same act()/FlatList timer hygiene as new-order-screen.test.tsx.
async function pressAndSettle(element: unknown, delayMs = 100) {
  await act(async () => {
    fireEvent.press(element as never);
    await new Promise<void>((resolve) => setTimeout(() => resolve(), delayMs));
  });
}
async function settle(delayMs = 100) {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(() => resolve(), delayMs));
  });
}
afterEach(async () => {
  jest.restoreAllMocks();
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 400));
});

const repositories = {
  customers: { list: async () => pageOf([customer(10, { name: "Padaria Central" }), customer(20, { name: "Mercado Sul" })]) },
  products: fakeProducts({ list: async () => pageOf([product(5, { description: "Copo 200 ml", listPrice: { state: "priced", unitPrice: "10.00", tableCode: 1, versionId: 1 } })]) }),
  orders: fakeOrders(),
};

function element(props: Partial<NewOrderScreenProps> = {}) {
  return withModal(<NewOrderScreen repositories={repositories} onUnauthenticated={() => undefined} {...props} />);
}

/** The app modal's dialog is labelled with its title; buttons are scoped to it. */
const dialog = (title: string) => within(screen.getByLabelText(title));

const padaria = { code: 10, name: "Padaria Central" };
const mercado = { code: 20, name: "Mercado Sul" };

describe("NewOrderScreen started from a customer sheet", () => {
  it("opens the catalog with the customer already selected, skipping the picker", async () => {
    const consumed = jest.fn();
    await render(element({ startRequest: { nonce: 1, customer: padaria }, onStartConsumed: consumed }));
    await settle();
    expect(consumed).toHaveBeenCalled();
    // The customer is chosen, so the order opens on the negotiation step; one Próximo reaches the catalog.
    expect(screen.getByLabelText("Etapa 2 de 4: Negociação")).toBeTruthy();
    await fillMandatoryHeader();
    await pressAndSettle(screen.getByRole("button", { name: "Próximo" }));
    expect(screen.getByText("Copo 200 ml")).toBeTruthy();
    expect(screen.getAllByText("Padaria Central").length).toBeGreaterThan(0);
    expect(screen.queryByText("Selecione o cliente")).toBeNull();
  });

  async function withCartOf(startWith: typeof padaria) {
    const view = await render(element());
    await pressAndSettle(await screen.findByText(startWith.name));
    await fillMandatoryHeader();
    await pressAndSettle(screen.getByRole("button", { name: "Próximo" }));
    await pressAndSettle(screen.getByRole("button", { name: "Adicionar Copo 200 ml ao carrinho" }));
    expect(screen.getByRole("tab", { name: "Carrinho (1)" })).toBeTruthy();
    return view;
  }

  it("asks before replacing an order in progress for another customer, and keeps it on 'Continuar pedido atual'", async () => {
    const view = await withCartOf(padaria);
    await view.rerender(element({ startRequest: { nonce: 2, customer: mercado } }));
    await settle();

    const ask = dialog("Você já possui um pedido em andamento");
    expect(ask.getByText(/Padaria Central/)).toBeTruthy();
    for (const label of ["Continuar pedido atual", "Iniciar novo pedido", "Cancelar"]) expect(ask.getByRole("button", { name: label })).toBeTruthy();

    await pressAndSettle(ask.getByRole("button", { name: "Continuar pedido atual" }));
    await settle();
    // The cart and its customer are untouched.
    expect(screen.getAllByText("Padaria Central").length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: "Carrinho (1)" })).toBeTruthy();
  });

  it("starts a fresh order for the new customer only after 'Iniciar novo pedido'", async () => {
    const view = await withCartOf(padaria);
    await view.rerender(element({ startRequest: { nonce: 2, customer: mercado } }));
    await settle();
    await pressAndSettle(dialog("Você já possui um pedido em andamento").getByRole("button", { name: "Iniciar novo pedido" }));
    await settle();
    expect(screen.getByText("Mercado Sul")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Carrinho (1)" })).toBeNull();
  });

  it("does not ask when the order in progress is already for the same customer", async () => {
    const view = await withCartOf(padaria);
    await view.rerender(element({ startRequest: { nonce: 2, customer: padaria } }));
    await settle();
    expect(screen.queryByLabelText("Você já possui um pedido em andamento")).toBeNull();
    expect(screen.getByRole("tab", { name: "Carrinho (1)" })).toBeTruthy();
  });

  it("does not ask when there is a customer but no items yet", async () => {
    const view = await render(element());
    await pressAndSettle(await screen.findByText("Padaria Central"));
    await fillMandatoryHeader();
    await pressAndSettle(screen.getByRole("button", { name: "Próximo" }));
    await view.rerender(element({ startRequest: { nonce: 2, customer: mercado } }));
    await settle();
    expect(screen.queryByLabelText("Você já possui um pedido em andamento")).toBeNull();
    expect(screen.getByText("Mercado Sul")).toBeTruthy();
  });
});

describe("NewOrderScreen started from a duplicated sale", () => {
  const copy = [{ key: "copy-0", productCode: 5, description: "Copo 200 ml", unit: "UN", quantityText: "3", discountText: "", price: { state: "priced" as const, unitPrice: "10.00", tableCode: 1, versionId: 1 } }];

  it("opens the cart pre-filled as a new, unsaved order", async () => {
    await render(element({ startRequest: { nonce: 1, customer: padaria, lines: copy } }));
    await settle();
    // A duplicated sale opens on the summary, with the copied lines ready to review.
    expect(screen.getByLabelText("Etapa 4 de 4: Resumo")).toBeTruthy();
    expect(screen.getAllByText("Padaria Central").length).toBeGreaterThan(0);
    await pressAndSettle(screen.getByRole("button", { name: "Editar produtos" }));
    expect(screen.getByRole("tab", { name: "Carrinho (1)" })).toBeTruthy();
  });

  it("never replaces an order in progress silently, even for the same customer", async () => {
    const view = await render(element());
    await pressAndSettle(await screen.findByText("Padaria Central"));
    await fillMandatoryHeader();
    await pressAndSettle(screen.getByRole("button", { name: "Próximo" }));
    await pressAndSettle(screen.getByRole("button", { name: "Adicionar Copo 200 ml ao carrinho" }));
    await view.rerender(element({ startRequest: { nonce: 2, customer: padaria, lines: copy } }));
    await settle();
    expect(screen.getByLabelText("Você já possui um pedido em andamento")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Carrinho (1)" })).toBeTruthy();
  });
});
