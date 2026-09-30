import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { CustomerRepository, ProductRepository } from "../data/ports";
import { customer, fakeOrders, fakeProducts, orderDetail, orderItem, pageOf, product } from "../test-doubles";
import { NewOrderScreen } from "./new-order-screen";

// Catalog-group discount edge cases (MOB-4a) split out of new-order-screen-discounts.test.tsx to keep each file's
// VirtualizedList timer bookkeeping small (see .claude/work handoff §11). Same press/settle rationale as
// new-order-screen.test.tsx: FlatList's internal cell-range-update timer must be waited out.
async function pressAndSettle(element: unknown, delayMs = 100) {
  await act(async () => {
    fireEvent.press(element as never);
    await new Promise<void>((resolve) => setTimeout(() => resolve(), delayMs));
  });
}

afterEach(async () => {
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 400));
});

const priced = (unitPrice: string) => ({ state: "priced" as const, unitPrice, tableCode: 1, versionId: 1 });

// Opens a saved draft with the given product codes for editing, so each line's group must be looked up via
// ProductRepository.get (lineFromOrderItem does not carry it), then opens the group-discount sheet.
async function reopenDraftAndOpenGroupSheet(codes: number[], products: ProductRepository) {
  const saved = orderDetail({
    draftNumber: 42,
    customerCode: 10,
    customerName: "Padaria Central",
    version: 1,
    items: codes.map((code) =>
      orderItem({ productCode: code, productDescription: `Produto ${code}`, quantity: "1", unitListPrice: "10.00", discountPercent: "0" }),
    ),
  });
  const customers: CustomerRepository = { list: async () => pageOf([customer(10, { name: "Padaria Central" })]) };
  const orders = fakeOrders({ create: async () => saved });
  await render(<NewOrderScreen repositories={{ customers, products, orders }} onUnauthenticated={jest.fn()} />);
  await pressAndSettle(await screen.findByText("Padaria Central"));
  for (const code of codes) {
    await pressAndSettle(await screen.findByRole("button", { name: `Adicionar Produto ${code} ao carrinho` }));
  }
  await pressAndSettle(screen.getByRole("tab", { name: `Carrinho (${codes.length})` }));
  await pressAndSettle(screen.getByRole("button", { name: "Salvar rascunho" }));
  await pressAndSettle(screen.getByRole("button", { name: "Editar pedido" }));
  await pressAndSettle(screen.getByRole("button", { name: "Desconto por grupo" }));
}

describe("NewOrderScreen catalog-group discount edge cases (MOB-4a)", () => {
  it("applies the discount to a reopened line once its group is resolved", async () => {
    const products: ProductRepository = fakeProducts({
      list: async () => pageOf([product(5, { description: "Produto 5", groupCode: 30, groupName: "Copos", listPrice: priced("10.00") })]),
      get: async (code) => product(code, { description: "Produto 5", groupCode: 30, groupName: "Copos", listPrice: priced("10.00") }),
    });
    await reopenDraftAndOpenGroupSheet([5], products);

    expect(await screen.findByText("Copos")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Desconto do grupo Copos (%)"), "20");
    await pressAndSettle(screen.getByRole("button", { name: "Aplicar descontos" }));

    expect((screen.getByLabelText("Desconto de Produto 5").props as { value: string }).value).toBe("20");
  });

  it("keeps the resolved group usable and warns when only some lookups fail", async () => {
    const products: ProductRepository = fakeProducts({
      list: async () =>
        pageOf([
          product(5, { description: "Produto 5", groupCode: 30, groupName: "Copos", listPrice: priced("10.00") }),
          product(6, { description: "Produto 6", groupCode: 40, groupName: "Pratos", listPrice: priced("10.00") }),
        ]),
      get: async (code) => {
        if (code === 6) throw new Error("network down");
        return product(code, { description: "Produto 5", groupCode: 30, groupName: "Copos", listPrice: priced("10.00") });
      },
    });
    await reopenDraftAndOpenGroupSheet([5, 6], products);

    expect(await screen.findByText("Não foi possível identificar o grupo de alguns itens; eles ficam de fora.")).toBeTruthy();
    expect(screen.getByText("Copos")).toBeTruthy();
    expect(screen.queryByText("Pratos")).toBeNull();

    await fireEvent.changeText(screen.getByLabelText("Desconto do grupo Copos (%)"), "10");
    await pressAndSettle(screen.getByRole("button", { name: "Aplicar descontos" }));

    expect((screen.getByLabelText("Desconto de Produto 5").props as { value: string }).value).toBe("10");
    expect((screen.getByLabelText("Desconto de Produto 6").props as { value: string }).value).toBe("");
  });

  it("buckets products with no catalog group under 'Sem grupo'", async () => {
    const customers: CustomerRepository = { list: async () => pageOf([customer(10, { name: "Padaria Central" })]) };
    const products: ProductRepository = fakeProducts({
      list: async () => pageOf([product(5, { description: "Produto avulso", groupCode: null, groupName: null, listPrice: priced("10.00") })]),
    });
    await render(<NewOrderScreen repositories={{ customers, products, orders: fakeOrders() }} onUnauthenticated={jest.fn()} />);
    await pressAndSettle(await screen.findByText("Padaria Central"));
    await pressAndSettle(await screen.findByRole("button", { name: "Adicionar Produto avulso ao carrinho" }));
    await pressAndSettle(screen.getByRole("tab", { name: "Carrinho (1)" }));
    await pressAndSettle(screen.getByRole("button", { name: "Desconto por grupo" }));

    expect(await screen.findByText("Sem grupo")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Desconto do grupo Sem grupo (%)"), "5");
    await pressAndSettle(screen.getByRole("button", { name: "Aplicar descontos" }));

    expect((screen.getByLabelText("Desconto de Produto avulso").props as { value: string }).value).toBe("5");
  });
});
