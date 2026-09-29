import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { CustomerRepository, ProductRepository } from "../data/ports";
import { customer, fakeOrders, pageOf, product } from "../test-doubles";
import { NewOrderScreen } from "./new-order-screen";

// See new-order-screen.test.tsx for why press/long-press are wrapped in an async act() with a real-timer delay,
// and why the file waits out FlatList's internal cell-range-update timer in afterEach: both apply here too
// (CustomerPicker/ProductPicker mount a real FlatList). Kept as a private copy per file (not a shared helper)
// so each test file settles its own VirtualizedList timers independently — this suite was split out from
// new-order-screen.test.tsx specifically to keep any one file's timer bookkeeping small (mobile-engineer, Slice 2).
async function pressAndSettle(element: unknown, delayMs = 100) {
  await act(async () => {
    fireEvent.press(element as never);
    await new Promise<void>((resolve) => setTimeout(() => resolve(), delayMs));
  });
}

async function longPressAndSettle(element: unknown, delayMs = 100) {
  await act(async () => {
    fireEvent(element as never, "longPress");
    await new Promise<void>((resolve) => setTimeout(() => resolve(), delayMs));
  });
}

afterEach(async () => {
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 400));
});

async function setupCartWithTwoLines() {
  const customers: CustomerRepository = { list: async () => pageOf([customer(10, { name: "Padaria Central" })]) };
  const products: ProductRepository = {
    list: async () =>
      pageOf([
        product(5, { description: "Copo 200 ml", listPrice: { state: "priced", unitPrice: "10.00", tableCode: 1, versionId: 1 } }),
        product(6, { description: "Prato 20cm", listPrice: { state: "priced", unitPrice: "20.00", tableCode: 1, versionId: 1 } }),
      ]),
  };
  const orders = fakeOrders();
  await render(<NewOrderScreen repositories={{ customers, products, orders }} onUnauthenticated={jest.fn()} />);
  await pressAndSettle(await screen.findByText("Padaria Central"));
  await pressAndSettle(await screen.findByRole("button", { name: "Adicionar Copo 200 ml ao carrinho" }));
  await pressAndSettle(screen.getByRole("button", { name: "Adicionar Prato 20cm ao carrinho" }));
  await pressAndSettle(screen.getByRole("tab", { name: "Carrinho (2)" }));
}

describe("NewOrderScreen discounts (mass and group apply, DISC-1/MOB-4)", () => {
  it("applies one discount percentage to every line in the cart (mass apply)", async () => {
    await setupCartWithTwoLines();
    await pressAndSettle(screen.getByRole("button", { name: "Desconto em massa" }));
    await fireEvent.changeText(screen.getByLabelText("Desconto em massa (%)"), "10");
    await pressAndSettle(screen.getByRole("button", { name: "Aplicar desconto" }));

    expect((screen.getByLabelText("Desconto de Copo 200 ml").props as { value: string }).value).toBe("10");
    expect((screen.getByLabelText("Desconto de Prato 20cm").props as { value: string }).value).toBe("10");
    // 10.00 - 10% = 9.00; 20.00 - 10% = 18.00; order total = 27.00. Domain math only, never a JS float.
    await waitFor(() => expect(screen.getByText("R$ 27,00")).toBeTruthy());
  });

  it("never discounts a line without a price during mass apply (P-09)", async () => {
    const customers: CustomerRepository = { list: async () => pageOf([customer(10, { name: "Padaria Central" })]) };
    const products: ProductRepository = {
      list: async () =>
        pageOf([
          product(5, { description: "Copo 200 ml", listPrice: { state: "priced", unitPrice: "10.00", tableCode: 1, versionId: 1 } }),
          product(9, { description: "Sem preço", listPrice: { state: "none", tableCode: null, versionId: null, noPriceReason: "no_resolved_table" } }),
        ]),
    };
    const orders = fakeOrders({
      getEntryConfiguration: async () => ({
        general: { enabled: true },
        sales: { defaultNegotiationTypeCode: null, negotiationTypes: [], orderBehavior: { allowDraftWithoutPrice: false } },
        products: { productWithoutPrice: { orderable: true } },
      }),
    });
    await render(<NewOrderScreen repositories={{ customers, products, orders }} onUnauthenticated={jest.fn()} />);
    await pressAndSettle(await screen.findByText("Padaria Central"));
    await pressAndSettle(await screen.findByRole("button", { name: "Adicionar Copo 200 ml ao carrinho" }));
    await pressAndSettle(screen.getByRole("button", { name: "Adicionar Sem preço ao carrinho" }));
    await pressAndSettle(screen.getByRole("tab", { name: "Carrinho (2)" }));

    await pressAndSettle(screen.getByRole("button", { name: "Desconto em massa" }));
    await fireEvent.changeText(screen.getByLabelText("Desconto em massa (%)"), "10");
    await pressAndSettle(screen.getByRole("button", { name: "Aplicar desconto" }));

    expect((screen.getByLabelText("Desconto de Copo 200 ml").props as { value: string }).value).toBe("10");
    expect(screen.getByLabelText("Desconto de Sem preço").props.editable).toBe(false);
  });

  it("selects lines via the selection-mode toggle and applies a discount to only that subset (group apply)", async () => {
    await setupCartWithTwoLines();
    await pressAndSettle(screen.getByRole("button", { name: "Selecionar itens" }));
    await pressAndSettle(screen.getByRole("checkbox", { name: "Selecionar Copo 200 ml" }));
    await pressAndSettle(screen.getByRole("button", { name: "Aplicar desconto aos selecionados" }));
    await fireEvent.changeText(screen.getByLabelText("Desconto no grupo selecionado (%)"), "20");
    await pressAndSettle(screen.getByRole("button", { name: "Aplicar desconto" }));

    expect((screen.getByLabelText("Desconto de Copo 200 ml").props as { value: string }).value).toBe("20");
    expect((screen.getByLabelText("Desconto de Prato 20cm").props as { value: string }).value).toBe("");
    // Applying leaves selection mode (mirrors the sheet closing): the toggle reads "Selecionar itens" again.
    expect(screen.getByRole("button", { name: "Selecionar itens" })).toBeTruthy();
  });

  it("long-pressing a line enters selection mode with that line already selected", async () => {
    await setupCartWithTwoLines();
    await longPressAndSettle(screen.getByText("Copo 200 ml"));

    const checkbox = screen.getByRole("checkbox", { name: "Selecionar Copo 200 ml" });
    expect(checkbox.props.accessibilityState.checked).toBe(true);
    expect(screen.getByRole("button", { name: "Cancelar seleção" })).toBeTruthy();
  });

  it("leaves selection mode without changing any discount when cancelled", async () => {
    await setupCartWithTwoLines();
    await pressAndSettle(screen.getByRole("button", { name: "Selecionar itens" }));
    await pressAndSettle(screen.getByRole("checkbox", { name: "Selecionar Copo 200 ml" }));
    await pressAndSettle(screen.getByRole("button", { name: "Cancelar seleção" }));

    expect(screen.getByRole("button", { name: "Selecionar itens" })).toBeTruthy();
    expect((screen.getByLabelText("Desconto de Copo 200 ml").props as { value: string }).value).toBe("");
  });

  it("changing a line's quantity never touches its discount (Slice 1 behaviour, still true with the toolbar wired up)", async () => {
    await setupCartWithTwoLines();
    fireEvent.changeText(screen.getByLabelText("Desconto de Copo 200 ml"), "15");
    await waitFor(() => expect((screen.getByLabelText("Desconto de Copo 200 ml").props as { value: string }).value).toBe("15"));

    fireEvent.changeText(screen.getByLabelText("Quantidade de Copo 200 ml"), "3");
    await waitFor(() => expect((screen.getByLabelText("Quantidade de Copo 200 ml").props as { value: string }).value).toBe("3"));

    expect((screen.getByLabelText("Desconto de Copo 200 ml").props as { value: string }).value).toBe("15");
  });
});
