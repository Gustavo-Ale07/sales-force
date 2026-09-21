import type { ApiSchema } from "@salesforce/contracts/client";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ORDER_ID,
  configuration,
  customer,
  customerDetail,
  customersPage,
  noPriceList,
  orderDetail,
  orderItem,
  pricedList,
  product,
  productsPage,
} from "../test/fixtures";
import { apiError, callsTo, renderApp, type Handlers } from "../test/harness";
import { SUBMIT_DISABLED_MESSAGE } from "./order-editor";

const FORBIDDEN_TERMS = /custo|margem|cost|margin/i;

const catalog = productsPage([
  product({ code: 2001, description: "Balão látex 9 pol. vermelho", listPrice: pricedList("12.5") }),
  product({ code: 2002, description: "Vela sem preço", listPrice: noPriceList("no_price_row") }),
]);

const newOrderHandlers = (extra: Handlers = {}): Handlers => ({
  "GET /customers/:code": { body: customerDetail() },
  "GET /customers": { body: customersPage([customer()]) },
  "GET /products": { body: catalog },
  ...extra,
});

async function addProduct(user: ReturnType<typeof renderApp>["user"], description: string) {
  const combobox = await screen.findByRole("combobox", { name: /Adicionar produto/ });
  await waitFor(() => expect(combobox).toBeEnabled());
  await user.click(combobox);
  await user.click(await screen.findByRole("option", { name: new RegExp(description) }));
}

const withConfiguration = (patch: (config: ApiSchema<"ConfigurationSummary">) => ApiSchema<"ConfigurationSummary">): Handlers => ({
  "GET /configuration": { body: { ...configuration, configuration: patch(configuration.configuration) } },
});

describe("Novo pedido", () => {
  it("cannot pick products before a customer is chosen", async () => {
    renderApp("/pedidos/novo", { handlers: newOrderHandlers() });
    expect(await screen.findByRole("heading", { name: /^Novo pedido/ })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Adicionar produto/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeDisabled();
  });

  it("computes the totals with the domain, showing 'Sem preço' and a partial total", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: newOrderHandlers() });
    await addProduct(user, "Balão");
    const quantity = await screen.findByLabelText("Quantidade de Balão látex 9 pol. vermelho");
    await user.clear(quantity);
    await user.type(quantity, "2,5");
    expect(screen.getByTestId("order-total")).toHaveTextContent("31,25");

    await addProduct(user, "Vela");
    const row = screen.getByText("Vela sem preço").closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("Sem preço");
    expect(row).not.toHaveTextContent(/0,00/);
    expect(screen.getByText("Total parcial estimado")).toBeInTheDocument();
    expect(screen.getByText("1 item sem preço não entra na soma.")).toBeInTheDocument();
    expect(screen.getByTestId("order-total")).toHaveTextContent("31,25");
  });

  it("rejects a duplicate product and an invalid quantity", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: newOrderHandlers() });
    await addProduct(user, "Balão");
    await addProduct(user, "Balão");
    expect(await screen.findByText("Produto já está no pedido")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Quantidade de Balão látex 9 pol. vermelho")).toHaveLength(1);

    const quantity = screen.getByLabelText("Quantidade de Balão látex 9 pol. vermelho");
    await user.clear(quantity);
    await user.type(quantity, "2.5");
    expect(await screen.findByText("Use vírgula como separador decimal.")).toBeInTheDocument();
    expect(quantity).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeDisabled();
  });

  it("saves with product and quantity only (no price in the request) and opens the saved draft", async () => {
    const { user, calls, router } = renderApp("/pedidos/novo?customer=1001", {
      handlers: newOrderHandlers({
        "POST /orders": { status: 201, body: orderDetail() },
        "GET /orders/:id": { body: orderDetail() },
      }),
    });
    await addProduct(user, "Balão");
    const quantity = await screen.findByLabelText("Quantidade de Balão látex 9 pol. vermelho");
    await user.clear(quantity);
    await user.type(quantity, "2");
    await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/pedidos/${ORDER_ID}`));
    const [created] = callsTo(calls, "POST", "/orders");
    expect(created?.body).toMatchObject({ customerCode: 1001, items: [{ productCode: 2001, quantity: "2" }] });
    expect(JSON.stringify(created?.body)).not.toMatch(/price|preco|total/i);
    expect(created?.body).toHaveProperty("clientRequestId", expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(await screen.findByRole("heading", { name: /^Rascunho nº 12/ })).toBeInTheDocument();
  });

  it("resends the same idempotency key when a failed save is retried unchanged", async () => {
    let attempts = 0;
    const { user, calls } = renderApp("/pedidos/novo?customer=1001", {
      handlers: newOrderHandlers({
        "POST /orders": () => {
          attempts += 1;
          return attempts === 1 ? apiError(503, "service_unavailable", "x", { requestId: "req-s-1" }) : { status: 201, body: orderDetail() };
        },
        "GET /orders/:id": { body: orderDetail() },
      }),
    });
    await addProduct(user, "Balão");
    await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect(await screen.findByText("req-s-1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(callsTo(calls, "POST", "/orders")).toHaveLength(2));
    const [first, second] = callsTo(calls, "POST", "/orders").map((call) => (call.body as { clientRequestId: string }).clientRequestId);
    expect(first).toBe(second);
  });

  it("lists the server's item issues in Portuguese when the save is rejected", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", {
      handlers: newOrderHandlers({
        "POST /orders": apiError(422, "validation_failed", "x", { issues: [{ path: "items[0]", code: "product_not_sellable" }], requestId: "req-v-1" }),
      }),
    });
    await addProduct(user, "Balão");
    await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect(await screen.findByText("Corrija os itens antes de salvar")).toBeInTheDocument();
    expect(screen.getByText("Item 1: Produto indisponível para venda.")).toBeInTheDocument();
  });

  it("blocks saving a line without price when the installation does not allow it", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", {
      handlers: newOrderHandlers(withConfiguration((config) => ({ ...config, sales: { ...config.sales, orderBehavior: { allowDraftWithoutPrice: false } } }))),
    });
    await addProduct(user, "Vela");
    expect(await screen.findByText("Este item não pode ser pedido sem preço nesta instalação.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeDisabled();
  });

  it("warns and blocks saving when the installation is not enabled for orders", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", {
      handlers: newOrderHandlers(withConfiguration((config) => ({ ...config, general: { ...config.general, enabled: false } }))),
    });
    expect(await screen.findByText("Pedidos ainda não habilitados")).toBeInTheDocument();
    await addProduct(user, "Balão");
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeDisabled();
  });

  it("asks for confirmation before leaving with unsaved changes", async () => {
    const { user, router } = renderApp("/pedidos/novo?customer=1001", { handlers: newOrderHandlers({ "GET /orders": { body: { items: [], page: 1, pageSize: 25, total: 0 } } }) });
    await addProduct(user, "Balão");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    const dialog = await screen.findByRole("dialog", { name: "Sair sem salvar?" });
    await user.click(within(dialog).getByRole("button", { name: "Continuar editando" }));
    expect(router.state.location.pathname).toBe("/pedidos/novo");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Sair sem salvar?" })).getByRole("button", { name: "Sair sem salvar" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/pedidos"));
  });

  it("renders neither cost nor margin", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", { handlers: newOrderHandlers() });
    await addProduct(user, "Balão");
    expect(document.body.textContent).not.toMatch(FORBIDDEN_TERMS);
  });
});

describe("Rascunho existente", () => {
  const existing = (order = orderDetail(), extra: Handlers = {}): Handlers => ({
    "GET /orders/:id": { body: order },
    "GET /products": { body: catalog },
    "GET /customers/:code": { body: customerDetail() },
    "GET /customers": { body: customersPage([customer()]) },
    ...extra,
  });

  it("loads the saved items with the prices and totals sent by the server", async () => {
    renderApp(`/pedidos/${ORDER_ID}`, { handlers: existing() });
    expect(await screen.findByRole("heading", { name: /^Rascunho nº 12/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Quantidade de Balão látex 9 pol. vermelho")).toHaveValue("2");
    expect(screen.getByTestId("order-total")).toHaveTextContent("25,00");
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeDisabled();
  });

  it("ends the submit action in the 'ERP submission disabled' message, never a success", async () => {
    const { user, calls } = renderApp(`/pedidos/${ORDER_ID}`, {
      handlers: existing(orderDetail(), {
        "POST /orders/:id/submit": apiError(409, "erp_submission_disabled", "Envio desabilitado.", { requestId: "req-sub-1" }),
      }),
    });
    await user.click(await screen.findByRole("button", { name: "Enviar ao ERP" }));
    expect(await screen.findByText(SUBMIT_DISABLED_MESSAGE)).toBeInTheDocument();
    expect(screen.getByText("Envio ao ERP indisponível")).toBeInTheDocument();
    expect(callsTo(calls, "POST", `/orders/${ORDER_ID}/submit`)).toHaveLength(1);
    expect(screen.queryByText(/enviado com sucesso|pedido enviado/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Rascunho salvo")).not.toBeInTheDocument();
  });

  it("shows other submit failures as errors with the correlation id", async () => {
    const { user } = renderApp(`/pedidos/${ORDER_ID}`, {
      handlers: existing(orderDetail(), { "POST /orders/:id/submit": apiError(503, "service_unavailable", "x", { requestId: "req-sub-2" }) }),
    });
    await user.click(await screen.findByRole("button", { name: "Enviar ao ERP" }));
    expect(await screen.findByText("req-sub-2")).toBeInTheDocument();
    expect(screen.queryByText(SUBMIT_DISABLED_MESSAGE)).not.toBeInTheDocument();
  });

  it("requires saving before submitting", async () => {
    const { user } = renderApp(`/pedidos/${ORDER_ID}`, { handlers: existing() });
    const quantity = await screen.findByLabelText("Quantidade de Balão látex 9 pol. vermelho");
    await user.clear(quantity);
    await user.type(quantity, "3");
    expect(screen.getByRole("button", { name: "Enviar ao ERP" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeEnabled();
  });

  it("replaces the draft with the expected version and shows the saved result", async () => {
    const saved = orderDetail({ version: 2, items: [orderItem({ quantity: "3", estimatedLineTotal: "37.5" })], totals: { estimatedTotal: "37.5", lineCount: 1, unpricedLineCount: 0, isPartial: false } });
    const { user, calls } = renderApp(`/pedidos/${ORDER_ID}`, { handlers: existing(orderDetail(), { "PUT /orders/:id": { body: saved } }) });
    const quantity = await screen.findByLabelText("Quantidade de Balão látex 9 pol. vermelho");
    await user.clear(quantity);
    await user.type(quantity, "3");
    await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect(await screen.findByText("Rascunho salvo")).toBeInTheDocument();
    const [put] = callsTo(calls, "PUT", `/orders/${ORDER_ID}`);
    expect(put?.body).toMatchObject({ expectedVersion: 1, customerCode: 1001, items: [{ productCode: 2001, quantity: "3" }] });
    expect(await screen.findByTestId("order-total")).toHaveTextContent("37,50");
  });

  it("offers a reload on a version conflict", async () => {
    const { user } = renderApp(`/pedidos/${ORDER_ID}`, {
      handlers: existing(orderDetail(), { "PUT /orders/:id": apiError(409, "version_conflict", "x", { requestId: "req-vc-1" }) }),
    });
    const quantity = await screen.findByLabelText("Quantidade de Balão látex 9 pol. vermelho");
    await user.clear(quantity);
    await user.type(quantity, "3");
    await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect(await screen.findByText("O rascunho foi alterado em outro lugar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recarregar" })).toBeInTheDocument();
  });

  it("is read-only once the order is no longer a draft", async () => {
    renderApp(`/pedidos/${ORDER_ID}`, { handlers: existing(orderDetail({ status: "sent", erpNumber: 555 })) });
    expect(await screen.findByText("Somente leitura")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Salvar rascunho" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enviar ao ERP" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Quantidade de Balão látex 9 pol. vermelho")).toHaveAttribute("readonly");
  });

  it("discards the draft from the editor and returns to the list", async () => {
    const { user, router, calls } = renderApp(`/pedidos/${ORDER_ID}`, {
      handlers: existing(orderDetail(), {
        "DELETE /orders/:id": { body: orderDetail({ status: "cancelled" }) },
        "GET /orders": { body: { items: [], page: 1, pageSize: 25, total: 0 } },
      }),
    });
    await user.click(await screen.findByRole("button", { name: "Descartar" }));
    const dialog = await screen.findByRole("dialog", { name: "Descartar rascunho?" });
    await user.click(within(dialog).getByRole("button", { name: "Descartar" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/pedidos"));
    expect(callsTo(calls, "DELETE", `/orders/${ORDER_ID}`)).toHaveLength(1);
  });

  it("shows not found and forbidden states", async () => {
    const notFound = renderApp(`/pedidos/${ORDER_ID}`, { handlers: { "GET /orders/:id": apiError(404, "not_found", "x") } });
    expect(await screen.findByText("Não encontrado")).toBeInTheDocument();
    notFound.unmount();
    renderApp(`/pedidos/${ORDER_ID}`, { handlers: { "GET /orders/:id": apiError(403, "forbidden", "x") } });
    expect(await screen.findByText("Sem permissão")).toBeInTheDocument();
  });

  it("shows a loading state while the draft loads", async () => {
    renderApp(`/pedidos/${ORDER_ID}`, { handlers: { "GET /orders/:id": () => new Promise(() => undefined) } });
    expect(await screen.findByText("Carregando pedido…")).toBeInTheDocument();
  });
});
