import { fireEvent, render, screen } from "@testing-library/react-native";
import { ApiRequestError } from "../data/api";
import type { OrderTemplatesPort } from "../data/order-templates";
import { fakeProducts, orderEntryConfiguration, pageOf, product } from "../test-doubles";
import { withModal } from "../test-render";
import { OrderTemplateFormScreen } from "./order-template-form-screen";

async function setup(create: OrderTemplatesPort["create"]) {
  let n = 0;
  const templates: OrderTemplatesPort = { list: jest.fn(), get: jest.fn(), create: jest.fn(create), remove: jest.fn() };
  const products = fakeProducts({ list: async () => pageOf([product(1, { listPrice: { state: "priced", unitPrice: "10.00", tableCode: 1, versionId: 1 } })]) });
  const onSaved = jest.fn();
  const onClose = jest.fn();
  await render(
    withModal(
      <OrderTemplateFormScreen
        customerCode={10}
        customerName="Padaria Central"
        templates={templates}
        products={products}
        orders={{ getEntryConfiguration: async () => orderEntryConfiguration() }}
        onUnauthenticated={jest.fn()}
        onSaved={onSaved}
        onClose={onClose}
        newId={() => `id-${++n}`}
      />,
    ),
  );
  return { templates, onSaved };
}

async function fillOne() {
  await fireEvent.changeText(await screen.findByLabelText("Nome do modelo"), "Mensal");
  await fireEvent.press(screen.getByLabelText("Adicionar produtos"));
  await fireEvent.press(await screen.findByLabelText("Adicionar Produto 1 ao carrinho"));
  await fireEvent.press(screen.getByLabelText("Concluir"));
}

describe("OrderTemplateFormScreen", () => {
  it("asks for a name and at least one product and sends nothing", async () => {
    const { templates } = await setup(async () => ({}) as never);
    await fireEvent.press(await screen.findByLabelText("Salvar modelo"));
    expect(await screen.findByText("Informe o nome do modelo.")).toBeTruthy();
    expect(screen.getByText("Adicione ao menos um produto.")).toBeTruthy();
    expect(templates.create).not.toHaveBeenCalled();
  });

  it("saves with the dataset of the device and a request id", async () => {
    const { templates, onSaved } = await setup(async () => ({}) as never);
    await fillOne();
    await fireEvent.press(await screen.findByLabelText("Salvar modelo"));
    await screen.findByLabelText("Salvar modelo");
    expect(templates.create).toHaveBeenCalledWith(10, {
      clientRequestId: "id-1",
      expectedDataset: { environment: "production", datasetId: "mirror-real-001" },
      name: "Mensal",
      items: [{ productCode: 1, quantity: "1" }],
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("keeps the same request id after a lost answer and shows the name-taken text", async () => {
    const create = jest.fn().mockRejectedValueOnce(new ApiRequestError({ status: 0, message: "x" })).mockRejectedValueOnce(new ApiRequestError({ status: 409, message: "x", reason: "template_name_taken" }));
    const { templates } = await setup(create);
    await fillOne();
    await fireEvent.press(await screen.findByLabelText("Salvar modelo"));
    expect(await screen.findByText("Sem conexão com o servidor. Nada foi alterado.")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Salvar modelo"));
    expect((await screen.findAllByText("Já existe um modelo com este nome para este cliente. Escolha outro nome.")).length).toBeGreaterThan(0);
    expect((templates.create as jest.Mock).mock.calls.map((call) => call[1].clientRequestId)).toEqual(["id-1", "id-1"]);
  });
});
