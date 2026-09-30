import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ApiRequestError } from "../data/api";
import type { CreateOrderRequest, CustomerRepository, OrderDetail, OrderRepository, ProductRepository } from "../data/ports";
import { customer, fakeOrders, fakeProducts, networkError, orderDetail, orderEntryConfiguration, pageOf, product, unauthenticatedError } from "../test-doubles";
import { NewOrderScreen } from "./new-order-screen";

// fireEvent.press is synchronous and only wraps the event dispatch itself in act(); a handler's own async
// continuation (e.g. save()'s catch/finally, or a FlatList's internal cell-range-update timer scheduled by the
// resulting render) lands later, outside any act() tracking. If that lands while RTL's own act()-wrapped polling
// (waitFor/findBy*) is concurrently open, React's module-global act-tracking corrupts ("You seem to have
// overlapping act() calls"), breaking every render for the rest of the file. Wrapping the press in an async
// act(), and awaiting a real timer inside that same act() call, keeps a single act() scope open long enough to
// deterministically capture the resulting update instead of racing RTL's polling for it.
async function pressAndSettle(element: unknown, delayMs = 100) {
  await act(async () => {
    fireEvent.press(element as never);
    await new Promise<void>((resolve) => setTimeout(() => resolve(), delayMs));
  });
}

// CustomerPicker/ProductPicker mount a real FlatList (VirtualizedList), which schedules an internal setTimeout
// (~updateCellsBatchingPeriod) for its cell-range update after every render of its data. RTL's automatic
// unmount-on-cleanup does not reliably cancel it; if it fires later while a *different* interaction's own act()
// scope is open (this test's last assertions, or the next test's first render), React's module-global act-tracking
// sees two overlapping act() calls and corrupts every render for the rest of the file ("You seem to have
// overlapping act() calls", then every following test fails to find its own content). Waiting out the real timer
// here — deliberately NOT wrapped in act(), so it fires during a genuine idle gap instead of colliding with another
// act() scope — lets it settle before RTL unmounts the tree for the next test.
afterEach(async () => {
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 400));
});

type Overrides = {
  customers?: CustomerRepository;
  products?: ProductRepository;
  orders?: OrderRepository;
  onUnauthenticated?: () => void;
};

async function setup(overrides: Overrides = {}) {
  const onUnauthenticated = overrides.onUnauthenticated ?? jest.fn();
  const repositories = {
    customers: overrides.customers ?? { list: async () => pageOf([customer(10, { name: "Padaria Central" })]) },
    products: overrides.products ?? fakeProducts({ list: async () => pageOf([product(5, { description: "Copo 200 ml", listPrice: { state: "priced", unitPrice: "10.00", tableCode: 1, versionId: 1 } })]) }),
    orders: overrides.orders ?? fakeOrders(),
  };
  const rendered = await render(<NewOrderScreen repositories={repositories} onUnauthenticated={onUnauthenticated} />);
  return { onUnauthenticated, repositories, ...rendered };
}

async function pickCustomerAndOpenProducts(overrides: Overrides = {}) {
  await setup(overrides);
  await pressAndSettle(await screen.findByText("Padaria Central"));
  expect(screen.getByText("Copo 200 ml")).toBeTruthy();
}

describe("NewOrderScreen", () => {
  it("starts on the customer step and moves to the catalog once one is picked", async () => {
    await pickCustomerAndOpenProducts();
    expect(screen.getByText("Padaria Central")).toBeTruthy();
  });

  it("adds a product to the cart, shows the badge and totals it in decimal", async () => {
    await pickCustomerAndOpenProducts();
    await pressAndSettle(screen.getByRole("button", { name: "Adicionar Copo 200 ml ao carrinho" }));
    expect(screen.getByRole("tab", { name: "Carrinho (1)" })).toBeTruthy();

    await pressAndSettle(screen.getByRole("tab", { name: "Carrinho (1)" }));
    expect(screen.getByText("Copo 200 ml")).toBeTruthy();
    // The line subtotal never shows for a zero discount (see cart-view.tsx); the line total, the order
    // summary's "Total de itens" and its "Total estimado" all coincide at "R$ 10,00" with one undiscounted line.
    expect(screen.getAllByText("R$ 10,00")).toHaveLength(3);
  });

  it("shows the current customer discreetly and steps the quantity from the catalog card, removing the line at one unit", async () => {
    await pickCustomerAndOpenProducts();
    expect(screen.getByText("Cliente")).toBeTruthy();
    await pressAndSettle(screen.getByRole("button", { name: "Adicionar Copo 200 ml ao carrinho" }));
    await pressAndSettle(screen.getByRole("button", { name: "Copo 200 ml, já no carrinho, adicionar outra unidade" }));
    expect(screen.getByLabelText("Quantidade no carrinho: 2")).toBeTruthy();
    await pressAndSettle(screen.getByRole("button", { name: "Diminuir quantidade de Copo 200 ml" }));
    expect(screen.getByLabelText("Quantidade no carrinho: 1")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Carrinho (1)" })).toBeTruthy();
    await pressAndSettle(screen.getByRole("button", { name: "Remover Copo 200 ml do carrinho" }));
    expect(screen.getByRole("tab", { name: "Carrinho" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Adicionar Copo 200 ml ao carrinho" })).toBeTruthy();
  });

  it("keeps the catalog search when going to the cart and back to the products", async () => {
    await pickCustomerAndOpenProducts();
    fireEvent.changeText(screen.getByLabelText("Buscar produto por descrição ou código"), "copo");
    await waitFor(() => expect(screen.getByDisplayValue("copo")).toBeTruthy());
    await pressAndSettle(screen.getByRole("tab", { name: "Carrinho" }), 600);
    await pressAndSettle(screen.getByRole("tab", { name: "Produtos" }));
    await waitFor(() => expect(screen.getByDisplayValue("copo")).toBeTruthy());
  });

  it("adding the same product again increases its quantity instead of duplicating the line", async () => {
    await pickCustomerAndOpenProducts();
    const addButton = screen.getByRole("button", { name: "Adicionar Copo 200 ml ao carrinho" });
    await pressAndSettle(addButton);
    await pressAndSettle(screen.getByRole("button", { name: "Copo 200 ml, já no carrinho, adicionar outra unidade" }));
    await pressAndSettle(screen.getByRole("tab", { name: "Carrinho (1)" }));
    expect(screen.getByDisplayValue("2")).toBeTruthy();
    // The line total, "Total de itens" and "Total estimado" all coincide at "R$ 20,00" with one undiscounted line.
    expect(screen.getAllByText("R$ 20,00")).toHaveLength(3);
  });

  it("removes a line from the cart", async () => {
    await pickCustomerAndOpenProducts();
    await pressAndSettle(screen.getByRole("button", { name: "Adicionar Copo 200 ml ao carrinho" }));
    await pressAndSettle(screen.getByRole("tab", { name: "Carrinho (1)" }));
    await pressAndSettle(screen.getByRole("button", { name: "Remover Copo 200 ml do carrinho" }));
    expect(screen.getByText("Nenhum item no carrinho. Adicione produtos no catálogo.")).toBeTruthy();
  });

  it("applies a per-item discount using domain math (never a JS float)", async () => {
    await pickCustomerAndOpenProducts();
    await pressAndSettle(screen.getByRole("button", { name: "Adicionar Copo 200 ml ao carrinho" }));
    await pressAndSettle(screen.getByRole("tab", { name: "Carrinho (1)" }));
    fireEvent.changeText(await screen.findByLabelText("Desconto de Copo 200 ml"), "10");
    // The discounted line total and the order summary's "Total estimado" coincide at "R$ 9,00" (see test above
    // for the equivalent zero-discount case, where all three totals coincide instead).
    await waitFor(() => expect(screen.getAllByText("R$ 9,00")).toHaveLength(2));
  });

  it("saves the draft sending only product, quantity and discount, never a price", async () => {
    let captured: CreateOrderRequest | undefined;
    const created: OrderDetail = orderDetail({ draftNumber: 42, customerCode: 10, customerName: "Padaria Central", estimatedTotal: "9.00" });
    const orders = fakeOrders({
      getEntryConfiguration: async () => orderEntryConfiguration({ sales: { defaultNegotiationTypeCode: 3, negotiationTypes: [], orderBehavior: { allowDraftWithoutPrice: false } } }),
      create: async (request) => {
        captured = request;
        return created;
      },
    });
    await pickCustomerAndOpenProducts({ orders });
    await pressAndSettle(screen.getByRole("button", { name: "Adicionar Copo 200 ml ao carrinho" }));
    await pressAndSettle(screen.getByRole("tab", { name: "Carrinho (1)" }));
    fireEvent.changeText(await screen.findByLabelText("Desconto de Copo 200 ml"), "10");
    await waitFor(() => expect(screen.getAllByText("R$ 9,00")).toHaveLength(2));
    await pressAndSettle(screen.getByRole("button", { name: "Salvar rascunho" }));

    expect(screen.getByText("Rascunho salvo")).toBeTruthy();
    expect(screen.getByText("Pedido nº 42 · Padaria Central")).toBeTruthy();
    expect(captured).toEqual({
      clientRequestId: expect.any(String),
      customerCode: 10,
      negotiationTypeCode: 3,
      notes: null,
      items: [{ productCode: 5, quantity: "1", discountPercent: "10" }],
    });
  });

  it("reuses the idempotency key for an identical retry, but mints a new one once the cart changes", async () => {
    const capturedIds: string[] = [];
    let shouldFail = true;
    const orders = fakeOrders({
      create: async (request) => {
        capturedIds.push(request.clientRequestId);
        if (shouldFail) throw networkError();
        return orderDetail({ draftNumber: 7, customerCode: 10, customerName: "Padaria Central", estimatedTotal: "9.00" });
      },
    });
    await pickCustomerAndOpenProducts({ orders });
    await pressAndSettle(screen.getByRole("button", { name: "Adicionar Copo 200 ml ao carrinho" }));
    await pressAndSettle(screen.getByRole("tab", { name: "Carrinho (1)" }));

    await pressAndSettle(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect(capturedIds).toHaveLength(1);
    expect(screen.getByText(/Sem conexão com o servidor/)).toBeTruthy();

    // Retry with the exact same payload (e.g. the request actually landed server-side but the response was lost):
    // must reuse the same clientRequestId so the server can replay instead of rejecting a duplicate.
    await pressAndSettle(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect(capturedIds).toHaveLength(2);
    expect(capturedIds[1]).toBe(capturedIds[0]);

    // Now the cart changes (a discount is applied): the payload differs, so a fresh id must be minted —
    // otherwise the server would answer idempotency_conflict forever and the user could never save again.
    fireEvent.changeText(await screen.findByLabelText("Desconto de Copo 200 ml"), "10");
    await waitFor(() => expect(screen.getAllByText("R$ 9,00")).toHaveLength(2));
    shouldFail = false;
    await pressAndSettle(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect(capturedIds).toHaveLength(3);
    expect(capturedIds[2]).not.toBe(capturedIds[0]);
    expect(screen.getByText("Rascunho salvo")).toBeTruthy();
  });

  it("shows the per-item issues of a rejected save", async () => {
    const orders = fakeOrders({
      create: async () => {
        throw new ApiRequestError({
          status: 400,
          code: "validation_failed",
          message: "Dados inválidos",
          issues: [{ path: "items[0].discountPercent", code: "invalid_discount" }],
        });
      },
    });
    await pickCustomerAndOpenProducts({ orders });
    await pressAndSettle(screen.getByRole("button", { name: "Adicionar Copo 200 ml ao carrinho" }));
    await pressAndSettle(screen.getByRole("tab", { name: "Carrinho (1)" }));
    await pressAndSettle(screen.getByRole("button", { name: "Salvar rascunho" }));

    expect(screen.getByText("Corrija os itens antes de salvar")).toBeTruthy();
    expect(screen.getByText("Item 1: Desconto inválido.")).toBeTruthy();
  });

  it("reports a network failure on save in pt-BR", async () => {
    const orders = fakeOrders({
      create: async () => {
        throw networkError();
      },
    });
    await pickCustomerAndOpenProducts({ orders });
    await pressAndSettle(screen.getByRole("button", { name: "Adicionar Copo 200 ml ao carrinho" }));
    await pressAndSettle(screen.getByRole("tab", { name: "Carrinho (1)" }));
    await pressAndSettle(screen.getByRole("button", { name: "Salvar rascunho" }));

    expect(screen.getByText(/Sem conexão com o servidor/)).toBeTruthy();
  });

  it("blocks saving and explains why when a no-price line is not orderable in this installation", async () => {
    const products: ProductRepository = fakeProducts({
      list: async () => pageOf([product(9, { description: "Sem preço", listPrice: { state: "none", tableCode: null, versionId: null, noPriceReason: "no_resolved_table" } })]),
    });
    const orders = fakeOrders({
      getEntryConfiguration: async () => orderEntryConfiguration({ sales: { defaultNegotiationTypeCode: null, negotiationTypes: [], orderBehavior: { allowDraftWithoutPrice: false } }, products: { productWithoutPrice: { orderable: false } } }),
    });
    await setup({ products, orders });
    await pressAndSettle(await screen.findByText("Padaria Central"));
    await pressAndSettle(await screen.findByRole("button", { name: "Adicionar Sem preço ao carrinho" }));
    await pressAndSettle(await screen.findByRole("tab", { name: "Carrinho (1)" }));

    expect(screen.getByText(/item\(ns\) sem preço não podem ser salvos nesta instalação/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Salvar rascunho" }).props.accessibilityState.disabled).toBe(true);
  });

  it("expires the session when the entry configuration read answers 401", async () => {
    const onUnauthenticated = jest.fn();
    const orders = fakeOrders({
      getEntryConfiguration: async () => {
        throw unauthenticatedError();
      },
    });
    await setup({ orders, onUnauthenticated });
    await waitFor(() => expect(onUnauthenticated).toHaveBeenCalled());
  });
});
