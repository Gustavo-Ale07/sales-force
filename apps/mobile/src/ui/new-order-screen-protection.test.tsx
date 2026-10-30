import { Alert } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { customer, draftRecord, fakeLocalOrders, fakeOrders, fakeProducts, orderEntryConfiguration, pageOf, product } from "../test-doubles";
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

const copo = product(5, { description: "Copo 200 ml", listPrice: { state: "priced", unitPrice: "10.00", tableCode: 1, versionId: 1 } });

function repositoriesWith(mode: "erp" | "force") {
  const base = orderEntryConfiguration();
  return {
    customers: { list: async () => pageOf([customer(10, { name: "Padaria Central" })]) },
    products: fakeProducts({ list: async () => pageOf([copo]) }),
    orders: fakeOrders({ getEntryConfiguration: async () => orderEntryConfiguration({ sales: { ...base.sales, discountAuthorityMode: mode } }) }),
  };
}

function element(mode: "erp" | "force", props: Partial<NewOrderScreenProps> = {}) {
  return <NewOrderScreen repositories={repositoriesWith(mode)} onUnauthenticated={() => undefined} {...props} />;
}

async function withOneItem(mode: "erp" | "force", props: Partial<NewOrderScreenProps> = {}) {
  const view = await render(element(mode, props));
  await pressAndSettle(await screen.findByText("Padaria Central"));
  await pressAndSettle(screen.getByRole("button", { name: "Adicionar Copo 200 ml ao carrinho" }));
  await pressAndSettle(screen.getByRole("tab", { name: "Carrinho (1)" }));
  return view;
}

describe("NewOrderScreen discount authority mode (D-L)", () => {
  it("tells the seller that discounts above the limit are released in Sankhya after sending, when the installation uses erp", async () => {
    await withOneItem("erp");
    expect(screen.getByText("Descontos acima do permitido passam pela liberação no Sankhya depois do envio.")).toBeTruthy();
  });

  it("shows no such notice in force mode", async () => {
    await withOneItem("force");
    expect(screen.queryByText(/liberação no Sankhya/)).toBeNull();
  });
});

describe("NewOrderScreen confirmations", () => {
  it("offers Descartar only when there is something unsaved, and asks before throwing it away", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await withOneItem("force");
    await pressAndSettle(screen.getByRole("button", { name: "Descartar" }));
    expect(alert).toHaveBeenCalledWith("Descartar pedido?", expect.any(String), expect.any(Array));
    // Nothing was discarded yet.
    expect(screen.getByRole("tab", { name: "Carrinho (1)" })).toBeTruthy();
    const buttons = alert.mock.calls[0]?.[2] as { text: string; onPress?: () => void }[];
    await act(async () => buttons.find((b) => b.text === "Descartar")?.onPress?.());
    await settle();
    expect(screen.getByText("Selecione o cliente")).toBeTruthy();
  });

  it("does not offer Descartar for an untouched order", async () => {
    await render(element("force", { startRequest: { nonce: 1, customer: { code: 10, name: "Padaria Central" } } }));
    await settle();
    expect(screen.queryByRole("button", { name: "Descartar" })).toBeNull();
  });

  it("asks before opening another order over unsaved edits, and keeps the edits on 'Continuar editando'", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const other = draftRecord({ localId: "other", customerCode: 20, customerName: "Mercado Sul" });
    const localOrders = fakeLocalOrders([other], { open: async () => ({ draft: other, lines: [] }) });
    const view = await withOneItem("force", { localOrders, resumeLocalId: null });
    await view.rerender(element("force", { localOrders, resumeLocalId: "other" }));
    await settle();
    expect(alert).toHaveBeenCalledWith("Há alterações não salvas", expect.any(String), expect.any(Array));
    expect(screen.getByText("Padaria Central")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Carrinho (1)" })).toBeTruthy();
  });

  it("opens the other order straight away when nothing is unsaved", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const other = draftRecord({ localId: "other", customerCode: 20, customerName: "Mercado Sul" });
    const localOrders = fakeLocalOrders([other], { open: async () => ({ draft: other, lines: [] }) });
    const view = await render(element("force", { localOrders, resumeLocalId: null }));
    await view.rerender(element("force", { localOrders, resumeLocalId: "other" }));
    await settle();
    expect(alert).not.toHaveBeenCalled();
    expect(screen.getByText("Mercado Sul")).toBeTruthy();
  });
});
