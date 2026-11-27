import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ApiRequestError } from "../data/api";
import type { OrderDetail, OrderRepository, ReplaceOrderRequest } from "../data/ports";
import { customer, fakeOrders, fakeProducts, orderDetail, orderItem, pageOf, product } from "../test-doubles";
import { NewOrderScreen } from "./new-order-screen";
import { withModal } from "../test-render";
import { fillMandatoryHeader } from "./fill-mandatory-header";

// See new-order-screen.test.tsx for why press is wrapped in an async act() with a real-timer delay, and why the
// file waits out FlatList's internal cell-range-update timer in afterEach. Split into its own file (mobile-engineer,
// Slice 2) so this suite's timer bookkeeping stays independent of the discount and Slice-1 suites.
async function pressAndSettle(element: unknown, delayMs = 100) {
  await act(async () => {
    fireEvent.press(element as never);
    await new Promise<void>((resolve) => setTimeout(() => resolve(), delayMs));
  });
}

// The single "Confirmar" button lives on the summary step: from the cart, "Próximo" gets there (already there when editing).
async function saveFromSummary() {
  const next = screen.queryByRole("button", { name: "Próximo" });
  if (next !== null) await pressAndSettle(next);
  await pressAndSettle(screen.getByRole("button", { name: "Confirmar" }));
}

afterEach(async () => {
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 400));
});

async function saveAFreshDraft(orders: OrderRepository) {
  const customers = { list: async () => pageOf([customer(10, { name: "Padaria Central" })]) };
  const products = fakeProducts({
    list: async () => pageOf([product(5, { description: "Copo 200 ml", listPrice: { state: "priced", unitPrice: "10.00", tableCode: 1, versionId: 1 } })]),
  });
  await render(withModal(<NewOrderScreen repositories={{ customers, products, orders }} onUnauthenticated={jest.fn()} />));
  await pressAndSettle(await screen.findByText("Padaria Central"));
  await fillMandatoryHeader();
  await pressAndSettle(screen.getByRole("button", { name: "Próximo" }));
  await pressAndSettle(await screen.findByRole("button", { name: "Adicionar Copo 200 ml ao carrinho" }));
  await pressAndSettle(screen.getByRole("tab", { name: "Carrinho (1)" }));
  await saveFromSummary();
  expect(await screen.findByText("Pedido salvo")).toBeTruthy();
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

    // Reopening lands on the summary, with the rebuilt line and the edit-mode save button.
    expect(screen.getByText("Copo 200 ml")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeTruthy();
    await pressAndSettle(screen.getByRole("button", { name: "Editar produtos" }));
    expect(screen.getByRole("tab", { name: "Carrinho (1)" })).toBeTruthy();
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
    await pressAndSettle(screen.getByRole("button", { name: "Editar produtos" }));
    await pressAndSettle(screen.getByRole("tab", { name: "Carrinho (1)" }));

    await act(async () => {
      fireEvent.changeText(screen.getByLabelText("Quantidade de Copo 200 ml"), "2");
    });
    await act(async () => {
      fireEvent(screen.getByLabelText("Quantidade de Copo 200 ml"), "blur");
    });
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText("Desconto de Copo 200 ml"), "10");
    });

    await saveFromSummary();

    expect(captured).toEqual({
      id: "0190a0c0-0000-7000-8000-000000000099",
      request: {
        expectedVersion: 1,
        expectedDataset: { environment: "production", datasetId: "mirror-real-001" },
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
    await saveFromSummary();

    expect(screen.getByText("Pedido alterado em outro lugar")).toBeTruthy();
    const reloadButton = screen.getByRole("button", { name: "Recarregar" });
    await pressAndSettle(reloadButton);

    expect(screen.queryByText("Pedido alterado em outro lugar")).toBeNull();
    await pressAndSettle(screen.getByRole("button", { name: "Editar produtos" }));
    await pressAndSettle(screen.getByRole("tab", { name: "Carrinho (1)" }));
    await waitFor(() => expect((screen.getByLabelText("Quantidade de Copo 200 ml").props as { value: string }).value).toBe("5"));
  });

  describe("editing an order already sent (EDIT-1, POST /orders/{id}/edit)", () => {
    const sentOrder = orderDetail({
      id: "0190a0c0-0000-7000-8000-000000000077",
      customerCode: 10,
      customerName: "Padaria Central",
      version: 3,
      items: [orderItem({ productCode: 5, productDescription: "Copo 200 ml", quantity: "1", unitListPrice: "10.00", discountPercent: "0" })],
    });
    const mount = async (orders: OrderRepository) => {
      const customers = { list: async () => pageOf([customer(10, { name: "Padaria Central" })]) };
      const products = fakeProducts();
      await render(withModal(<NewOrderScreen repositories={{ customers, products, orders }} onUnauthenticated={jest.fn()} editRequest={{ nonce: 1, orderId: sentOrder.id }} />));
    };

    it("loads the server order, confirms through edit with a clientRequestId and the loaded version, never replace", async () => {
      const edit = jest.fn(async (_id: string, request: { expectedVersion: number }) => ({ ...sentOrder, version: request.expectedVersion + 1, status: "queued" as const }));
      const replace = jest.fn();
      await mount(fakeOrders({ get: async () => sentOrder, edit, replace }));
      await pressAndSettle(await screen.findByRole("button", { name: "Confirmar" }));
      expect(await screen.findByText("Edição enviada ao Sankhya")).toBeTruthy();
      expect(replace).not.toHaveBeenCalled();
      const [id, request] = edit.mock.calls[0]! as unknown as [string, { clientRequestId: string; expectedVersion: number; customerCode: number }];
      expect(id).toBe(sentOrder.id);
      expect(request.expectedVersion).toBe(3);
      expect(request.customerCode).toBe(10);
      expect(request.clientRequestId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("reuses the same clientRequestId when the same attempt is repeated after a failure", async () => {
      const ids: string[] = [];
      const edit = jest.fn(async (_id: string, request: { clientRequestId: string }) => {
        ids.push(request.clientRequestId);
        throw new ApiRequestError({ status: 409, code: "not_editable_in_erp", message: "x" });
      });
      await mount(fakeOrders({ get: async () => sentOrder, edit }));
      await pressAndSettle(await screen.findByRole("button", { name: "Confirmar" }));
      expect(await screen.findByText("Pedido não pode ser editado")).toBeTruthy();
      await pressAndSettle(screen.getByRole("button", { name: "Confirmar" }));
      expect(ids).toHaveLength(2);
      expect(ids[0]).toBe(ids[1]);
    });
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
    await render(withModal(<NewOrderScreen repositories={{ customers, products, orders }} onUnauthenticated={onUnauthenticated} />));
    await pressAndSettle(await screen.findByText("Padaria Central"));
    await fillMandatoryHeader();
    await pressAndSettle(screen.getByRole("button", { name: "Próximo" }));
    await pressAndSettle(await screen.findByRole("button", { name: "Adicionar Copo 200 ml ao carrinho" }));
    await pressAndSettle(screen.getByRole("tab", { name: "Carrinho (1)" }));
    await saveFromSummary();
    await pressAndSettle(screen.getByRole("button", { name: "Editar pedido" }));
    await saveFromSummary();
    await pressAndSettle(screen.getByRole("button", { name: "Recarregar" }));

    expect(onUnauthenticated).toHaveBeenCalled();
  });
});
