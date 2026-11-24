import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReplaceOrderRequest } from "../data/ports";
import { customer, fakeOrders, fakeProducts, orderDetail, orderItem, pageOf, product } from "../test-doubles";
import { NewOrderScreen } from "./new-order-screen";
import { withModal } from "../test-render";
import { fillMandatoryHeader } from "./fill-mandatory-header";

async function pressAndSettle(element: unknown, delayMs = 100) {
  await act(async () => {
    fireEvent.press(element as never);
    await new Promise<void>((resolve) => setTimeout(() => resolve(), delayMs));
  });
}

afterEach(async () => {
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 400));
});

async function openSavedOrderForEdit(saved: ReturnType<typeof orderDetail>, replace: (id: string, request: ReplaceOrderRequest) => Promise<ReturnType<typeof orderDetail>>) {
  const orders = fakeOrders({ create: async () => saved, replace });
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
  await pressAndSettle(screen.getByRole("button", { name: "Próximo" }));
  await pressAndSettle(screen.getByRole("button", { name: "Confirmar" }));
  expect(await screen.findByText("Pedido salvo")).toBeTruthy();
  await pressAndSettle(screen.getByRole("button", { name: "Editar pedido" }));
  await pressAndSettle(screen.getByRole("button", { name: "Confirmar" }));
}

const line = () => orderItem({ productCode: 5, productDescription: "Copo 200 ml", quantity: "1", unitListPrice: "10.00", discountPercent: "0" });

describe("NewOrderScreen - informational mark discountAboveLimitAccepted on a server order", () => {
  it("resends the mark read from the server order when it is edited and saved", async () => {
    let captured: ReplaceOrderRequest | undefined;
    const saved = orderDetail({ id: "0190a0c0-0000-7000-8000-000000000099", draftNumber: 42, customerCode: 10, customerName: "Padaria Central", version: 1, discountAboveLimitAccepted: true, items: [line()] });
    await openSavedOrderForEdit(saved, async (_id, request) => {
      captured = request;
      return { ...saved, version: 2 };
    });
    expect(captured?.discountAboveLimitAccepted).toBe(true);
  });

  it("an order without the field (older server) is saved without it", async () => {
    let captured: ReplaceOrderRequest | undefined;
    const saved = orderDetail({ id: "0190a0c0-0000-7000-8000-000000000099", draftNumber: 42, customerCode: 10, customerName: "Padaria Central", version: 1, items: [line()] });
    await openSavedOrderForEdit(saved, async (_id, request) => {
      captured = request;
      return { ...saved, version: 2 };
    });
    expect(captured).toBeDefined();
    expect(captured).not.toHaveProperty("discountAboveLimitAccepted");
  });
});
