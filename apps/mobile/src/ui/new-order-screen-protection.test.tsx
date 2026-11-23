import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { customer, draftRecord, fakeLocalOrders, fakeOrders, fakeProducts, orderEntryConfiguration, pageOf, product } from "../test-doubles";
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

/** The app modal's dialog is labelled with its title; its buttons are scoped to it (the screen has its own "Descartar"). */
const dialog = (title: string) => within(screen.getByLabelText(title));

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
  return withModal(<NewOrderScreen repositories={repositoriesWith(mode)} onUnauthenticated={() => undefined} {...props} />);
}

async function withOneItem(mode: "erp" | "force", props: Partial<NewOrderScreenProps> = {}) {
  const view = await render(element(mode, props));
  await pressAndSettle(await screen.findByText("Padaria Central"));
  await fillMandatoryHeader();
  await pressAndSettle(screen.getByRole("button", { name: "Próximo" }));
  await pressAndSettle(screen.getByRole("button", { name: "Adicionar Copo 200 ml ao carrinho" }));
  await pressAndSettle(screen.getByRole("tab", { name: "Carrinho (1)" }));
  return view;
}

describe("NewOrderScreen discount authority mode (D-L)", () => {
  // Owner 2026-11-23: the explanatory ERP notice left the summary; the seller is told by the server outcome instead.
  it("shows no discount-authority notice on the summary, in erp or force mode", async () => {
    await withOneItem("erp");
    await pressAndSettle(screen.getByRole("button", { name: "Próximo" }));
    expect(screen.getByLabelText("Etapa 4 de 4: Resumo")).toBeTruthy();
    expect(screen.queryByText(/liberação no Sankhya/)).toBeNull();
  });

  it("shows no such notice in force mode", async () => {
    await withOneItem("force");
    await pressAndSettle(screen.getByRole("button", { name: "Próximo" }));
    expect(screen.queryByText(/liberação no Sankhya/)).toBeNull();
  });
});

describe("NewOrderScreen confirmations", () => {
  it("offers Descartar only when there is something unsaved, and asks before throwing it away", async () => {
    await withOneItem("force");
    await pressAndSettle(screen.getByRole("button", { name: "Próximo" }));
    await pressAndSettle(screen.getByRole("button", { name: "Descartar" }));
    // The confirmation is the app modal (never a native Alert); nothing was discarded yet.
    expect(screen.getByLabelText("Descartar pedido?")).toBeTruthy();
    expect(screen.getByLabelText("Etapa 4 de 4: Resumo")).toBeTruthy();
    await pressAndSettle(dialog("Descartar pedido?").getByRole("button", { name: "Descartar" }));
    await settle();
    expect(screen.getByText("Selecione o cliente")).toBeTruthy();
  });

  it("keeps the order when the discard confirmation is answered 'Continuar editando'", async () => {
    await withOneItem("force");
    await pressAndSettle(screen.getByRole("button", { name: "Próximo" }));
    await pressAndSettle(screen.getByRole("button", { name: "Descartar" }));
    await pressAndSettle(dialog("Descartar pedido?").getByRole("button", { name: "Continuar editando" }));
    await settle();
    expect(screen.getByLabelText("Etapa 4 de 4: Resumo")).toBeTruthy();
    expect(screen.queryByText("Selecione o cliente")).toBeNull();
  });

  it("does not offer Descartar for an untouched order", async () => {
    await render(element("force", { startRequest: { nonce: 1, customer: { code: 10, name: "Padaria Central" } } }));
    await settle();
    expect(screen.queryByRole("button", { name: "Descartar" })).toBeNull();
  });

  it("asks before opening another order over unsaved edits, and keeps the edits on 'Continuar editando'", async () => {
    const other = draftRecord({ localId: "other", customerCode: 20, customerName: "Mercado Sul" });
    const localOrders = fakeLocalOrders([other], { open: async () => ({ draft: other, lines: [] }) });
    const view = await withOneItem("force", { localOrders, resumeLocalId: null });
    await view.rerender(element("force", { localOrders, resumeLocalId: "other" }));
    await settle();
    expect(screen.getByLabelText("Há alterações não salvas")).toBeTruthy();
    await pressAndSettle(dialog("Há alterações não salvas").getByRole("button", { name: "Continuar editando" }));
    expect(screen.getByText("Padaria Central")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Carrinho (1)" })).toBeTruthy();
  });

  it("opens the other order straight away when nothing is unsaved", async () => {
    const other = draftRecord({ localId: "other", customerCode: 20, customerName: "Mercado Sul" });
    const localOrders = fakeLocalOrders([other], { open: async () => ({ draft: other, lines: [] }) });
    const view = await render(element("force", { localOrders, resumeLocalId: null }));
    await view.rerender(element("force", { localOrders, resumeLocalId: "other" }));
    await settle();
    expect(screen.queryByLabelText("Há alterações não salvas")).toBeNull();
    expect(screen.getAllByText("Mercado Sul").length).toBeGreaterThan(0);
  });
});
