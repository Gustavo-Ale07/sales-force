import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ApiRequestError } from "../data/api";
import type { OrderDetail, OrderRepository, ReplaceOrderRequest } from "../data/ports";
import { customer, fakeOrders, fakeProducts, orderDetail, orderItem, pageOf, product } from "../test-doubles";
import { NewOrderScreen } from "./new-order-screen";

// See new-order-screen.test.tsx for why press is wrapped in an async act() with a real-timer delay, and why the
// file waits out FlatList's internal cell-range-update timer in afterEach. Split into its own file (mobile-engineer,
// Slice 2) so this suite's timer bookkeeping stays independent of the discount and Slice-1 suites.
async function pressAndSettle(element: unknown, delayMs = 100) {
  await act(async () => {
    fireEvent.press(element as never);
    await new Promise<void>((resolve) => setTimeout(() => resolve(), delayMs));
  });
}

afterEach(async () => {
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 400));
});

async function saveAFreshDraft(orders: OrderRepository) {
  const customers = { list: async () => pageOf([customer(10, { name: "Padaria Central" })]) };
  const products = fakeProducts({
    list: async () => pageOf([product(5, { description: "Copo 200 ml", listPrice: { state: "priced", unitPrice: "10.00", tableCode: 1, versionId: 1 } })]),
  });
  await render(<NewOrderScreen repositories={{ customers, products, orders }} onUnauthenticated={jest.fn()} />);
  await pressAndSettle(await screen.findByText("Padaria Central"));
  await pressAndSettle(await screen.findByRole("button", { name: "Adicionar Copo 200 ml ao carrinho" }));
  await pressAndSettle(screen.getByRole("tab", { name: "Carrinho (1)" }));
  await pressAndSettle(screen.getByRole("button", { name: "Salvar rascunho" }));
  expect(await screen.findByText("Rascunho salvo")).toBeTruthy();
}

describe("NewOrderScreen — reopening a saved draft for editing (PUT /orders/{id})", () => {
  it("reopens the just-saved draft, rebuilding its lines from the server response", async () => {
    const saved = orderDetail({
      draftNumber: 42,
      customerCode: 10,
      customerName: "Padaria Central",
      version: 1,
      items: [orderItem({ productCode: 5, productDescription: "Copo 200 ml", quantity: "1", unitListPrice: "10.00", discountPercent: "0" })],
    });
    const orders = fakeOrders({ create: async () => saved });
    await saveAFreshDraft(orders);

    await pressAndSettle(screen.getByRole("button", { name: "Editar pedido" }));

    expect(screen.getByRole("tab", { name: "Carrinho (1)" })).toBeTruthy();
    expect(screen.getByText("Copo 200 ml")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeTruthy();
    // The customer stays fixed while editing an existing draft in this slice: no "Trocar" action.
    expect(screen.queryByRole("button", { name: "Trocar cliente" })).toBeNull();
  });

  it("saves an edited draft through PUT /orders/{id} with optimistic concurrency, never re-creating it", async () => {
    const saved = orderDetail({
      id: "0190a0c0-0000-7000-8000-000000000099",
      draftNumber: 42,
      customerCode: 10,
      customerName: "Padaria Central",
      version: 1,
      negotiationTypeCode: 3,
      notes: "Entrega pela manhã",
      items: [orderItem({ productCode: 5, productDescription: "Copo 200 ml", quantity: "1", unitListPrice: "10.00", discountPercent: "0" })],
    });
    let captured: { id: string; request: ReplaceOrderRequest } | undefined;
    const orders = fakeOrders({
      create: async () => saved,
      replace: async (id, request) => {
        captured = { id, request };
        return { ...saved, version: request.expectedVersion + 1, items: [orderItem({ productCode: 5, productDescription: "Copo 200 ml", quantity: "2", unitListPrice: "10.00", discountPercent: "10" })] };
      },
    });
    await saveAFreshDraft(orders);
    await pressAndSettle(screen.getByRole("button", { name: "Editar pedido" }));

    fireEvent.changeText(screen.getByLabelText("Quantidade de Copo 200 ml"), "2");
    await waitFor(() => expect((screen.getByLabelText("Quantidade de Copo 200 ml").props as { value: string }).value).toBe("2"));
    await fireEvent.changeText(screen.getByLabelText("Desconto de Copo 200 ml"), "10");

    await pressAndSettle(screen.getByRole("button", { name: "Salvar alterações" }));

    expect(captured).toEqual({
      id: "0190a0c0-0000-7000-8000-000000000099",
      request: {
        expectedVersion: 1,
        customerCode: 10,
        negotiationTypeCode: 3,
        notes: "Entrega pela manhã",
        items: [{ productCode: 5, quantity: "2", discountPercent: "10" }],
      },
    });
    expect(screen.getByText("Alterações salvas")).toBeTruthy();
  });

  it("offers to reload, never overwriting, when the draft changed elsewhere (version_conflict)", async () => {
    const saved = orderDetail({
      id: "0190a0c0-0000-7000-8000-000000000099",
      draftNumber: 42,
      customerCode: 10,
      customerName: "Padaria Central",
      version: 1,
      items: [orderItem({ productCode: 5, productDescription: "Copo 200 ml", quantity: "1", unitListPrice: "10.00", discountPercent: "0" })],
    });
    const reloaded: OrderDetail = {
      ...saved,
      version: 2,
      items: [orderItem({ productCode: 5, productDescription: "Copo 200 ml", quantity: "5", unitListPrice: "10.00", discountPercent: "0" })],
    };
    const orders = fakeOrders({
      create: async () => saved,
      replace: async () => {
        throw new ApiRequestError({ status: 409, code: "version_conflict", message: "Conflito de versão" });
      },
      get: async () => reloaded,
    });
    await saveAFreshDraft(orders);
    await pressAndSettle(screen.getByRole("button", { name: "Editar pedido" }));
    await pressAndSettle(screen.getByRole("button", { name: "Salvar alterações" }));

    expect(screen.getByText("O rascunho foi alterado em outro lugar")).toBeTruthy();
    const reloadButton = screen.getByRole("button", { name: "Recarregar pedido" });
    await pressAndSettle(reloadButton);

    expect(screen.queryByText("O rascunho foi alterado em outro lugar")).toBeNull();
    await waitFor(() => expect((screen.getByLabelText("Quantidade de Copo 200 ml").props as { value: string }).value).toBe("5"));
  });

  it("expires the session when reopening a draft fails with 401", async () => {
    const saved = orderDetail({
      draftNumber: 42,
      customerCode: 10,
      customerName: "Padaria Central",
      version: 1,
      items: [orderItem({ productCode: 5, productDescription: "Copo 200 ml", quantity: "1", unitListPrice: "10.00", discountPercent: "0" })],
    });
    const onUnauthenticated = jest.fn();
    const orders = fakeOrders({
      create: async () => saved,
      replace: async () => {
        throw new ApiRequestError({ status: 409, code: "version_conflict", message: "Conflito de versão" });
      },
      get: async () => {
        throw new ApiRequestError({ status: 401, code: "unauthenticated", message: "Sessão expirada" });
      },
    });
    const customers = { list: async () => pageOf([customer(10, { name: "Padaria Central" })]) };
    const products = fakeProducts({
      list: async () => pageOf([product(5, { description: "Copo 200 ml", listPrice: { state: "priced", unitPrice: "10.00", tableCode: 1, versionId: 1 } })]),
    });
    await render(<NewOrderScreen repositories={{ customers, products, orders }} onUnauthenticated={onUnauthenticated} />);
    await pressAndSettle(await screen.findByText("Padaria Central"));
    await pressAndSettle(await screen.findByRole("button", { name: "Adicionar Copo 200 ml ao carrinho" }));
    await pressAndSettle(screen.getByRole("tab", { name: "Carrinho (1)" }));
    await pressAndSettle(screen.getByRole("button", { name: "Salvar rascunho" }));
    await pressAndSettle(screen.getByRole("button", { name: "Editar pedido" }));
    await pressAndSettle(screen.getByRole("button", { name: "Salvar alterações" }));
    await pressAndSettle(screen.getByRole("button", { name: "Recarregar pedido" }));

    expect(onUnauthenticated).toHaveBeenCalled();
  });
});
