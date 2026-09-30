import { Alert } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { customer, fakeOrders, fakeProducts, pageOf, product } from "../test-doubles";
import { NewOrderScreen, type NewOrderScreenProps } from "./new-order-screen";

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
  return <NewOrderScreen repositories={repositories} onUnauthenticated={() => undefined} {...props} />;
}

const padaria = { code: 10, name: "Padaria Central" };
const mercado = { code: 20, name: "Mercado Sul" };

describe("NewOrderScreen started from a customer sheet", () => {
  it("opens the catalog with the customer already selected, skipping the picker", async () => {
    const consumed = jest.fn();
    await render(element({ startRequest: { nonce: 1, customer: padaria }, onStartConsumed: consumed }));
    await settle();
    expect(consumed).toHaveBeenCalled();
    expect(screen.getByText("Copo 200 ml")).toBeTruthy();
    expect(screen.getByText("Padaria Central")).toBeTruthy();
    expect(screen.queryByText("Selecione o cliente")).toBeNull();
  });

  async function withCartOf(startWith: typeof padaria) {
    const view = await render(element());
    await pressAndSettle(await screen.findByText(startWith.name));
    await pressAndSettle(screen.getByRole("button", { name: "Adicionar Copo 200 ml ao carrinho" }));
    expect(screen.getByRole("tab", { name: "Carrinho (1)" })).toBeTruthy();
    return view;
  }

  it("asks before replacing an order in progress for another customer, and keeps it on 'Continuar pedido atual'", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const view = await withCartOf(padaria);
    await view.rerender(element({ startRequest: { nonce: 2, customer: mercado } }));
    await settle();

    expect(alert).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alert.mock.calls[0]!;
    expect(title).toBe("Você já possui um pedido em andamento");
    expect(message).toContain("Padaria Central");
    expect(buttons?.map((button) => button.text)).toEqual(["Continuar pedido atual", "Iniciar novo pedido", "Cancelar"]);

    await act(async () => buttons?.[0]?.onPress?.());
    await settle();
    // The cart and its customer are untouched.
    expect(screen.getByText("Padaria Central")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Carrinho (1)" })).toBeTruthy();
  });

  it("starts a fresh order for the new customer only after 'Iniciar novo pedido'", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const view = await withCartOf(padaria);
    await view.rerender(element({ startRequest: { nonce: 2, customer: mercado } }));
    await settle();
    const buttons = alert.mock.calls[0]![2]!;

    await act(async () => buttons[1]?.onPress?.());
    await settle();
    expect(screen.getByText("Mercado Sul")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Carrinho (1)" })).toBeNull();
  });

  it("does not ask when the order in progress is already for the same customer", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const view = await withCartOf(padaria);
    await view.rerender(element({ startRequest: { nonce: 2, customer: padaria } }));
    await settle();
    expect(alert).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Carrinho (1)" })).toBeTruthy();
  });

  it("does not ask when there is a customer but no items yet", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const view = await render(element());
    await pressAndSettle(await screen.findByText("Padaria Central"));
    await view.rerender(element({ startRequest: { nonce: 2, customer: mercado } }));
    await settle();
    expect(alert).not.toHaveBeenCalled();
    expect(screen.getByText("Mercado Sul")).toBeTruthy();
  });
});
