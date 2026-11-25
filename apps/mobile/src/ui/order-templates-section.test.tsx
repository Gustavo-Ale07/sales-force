import { fireEvent, render, screen } from "@testing-library/react-native";
import { ApiRequestError } from "../data/api";
import type { OrderTemplate, OrderTemplatesPort } from "../data/order-templates";
import { fakeProducts, orderEntryConfiguration, pageOf, product } from "../test-doubles";
import { withModal } from "../test-render";
import { OrderTemplatesSection } from "./order-templates-section";

const template: OrderTemplate = { id: "t1", name: "Reposição mensal", itemCount: 1, customerCode: 10 } as OrderTemplate;

async function setup(port: Partial<OrderTemplatesPort>) {
  const templates: OrderTemplatesPort = {
    list: jest.fn(async () => [template]),
    get: jest.fn(async () => ({ ...template, items: [{ productCode: 1, quantity: "3" }] }) as never),
    create: jest.fn(),
    remove: jest.fn(async () => undefined),
    ...port,
  };
  const products = fakeProducts({
    list: async ({ customerCode }) => pageOf(customerCode === undefined ? [] : [product(1, { listPrice: { state: "priced", unitPrice: "10.00", tableCode: 1, versionId: 1 } })]),
  });
  const onUse = jest.fn();
  const onCreate = jest.fn();
  const orders = { getEntryConfiguration: async () => orderEntryConfiguration() };
  await render(withModal(<OrderTemplatesSection customerCode={10} templates={templates} products={products} orders={orders} onCreate={onCreate} onUse={onUse} />));
  return { templates, onUse, onCreate };
}

describe("OrderTemplatesSection", () => {
  it("lists the templates and opens a new order with their lines on Usar", async () => {
    const { onUse } = await setup({});
    expect(await screen.findByText("Reposição mensal")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Usar modelo Reposição mensal"));
    await screen.findByLabelText("Usar modelo Reposição mensal");
    expect(onUse).toHaveBeenCalledTimes(1);
    expect(onUse.mock.calls[0][0].map((line: { productCode: number; quantityText: string }) => [line.productCode, line.quantityText])).toEqual([[1, "3"]]);
  });

  it("shows the empty state and opens the form on Novo modelo", async () => {
    const { onCreate } = await setup({ list: async () => [] });
    expect(await screen.findByText("Nenhum pedido recorrente para este cliente")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Novo pedido recorrente"));
    expect(onCreate).toHaveBeenCalled();
  });

  it("offline: shows the connection error and retries", async () => {
    const list = jest.fn().mockRejectedValueOnce(new ApiRequestError({ status: 0, message: "x" })).mockResolvedValue([]);
    await setup({ list });
    expect(await screen.findByText("Sem conexão com o servidor. Nada foi alterado.")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Tentar de novo"));
    expect(await screen.findByText("Nenhum pedido recorrente para este cliente")).toBeTruthy();
  });

  it("deletes after confirmation", async () => {
    const { templates } = await setup({});
    await fireEvent.press(await screen.findByLabelText("Apagar modelo Reposição mensal"));
    await fireEvent.press(await screen.findByLabelText("Apagar"));
    await screen.findByLabelText("Novo pedido recorrente");
    expect(templates.remove).toHaveBeenCalledWith("t1");
  });
});
