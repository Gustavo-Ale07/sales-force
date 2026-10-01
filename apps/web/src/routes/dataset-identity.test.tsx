import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ORDER_ID,
  customer,
  customerDetail,
  customersPage,
  orderDetail,
  orderEntryConfiguration,
  orderTemplate,
  orderTemplatesPage,
  ordersPage,
  pricedList,
  product,
  productsPage,
} from "../test/fixtures";
import { apiError, callsTo, renderApp, type Handlers } from "../test/harness";

/** The dataset identity is propagated explicitly: the one the screen LOADED under (order-entry configuration), never a
 * fresh read at submit time; unknown identity blocks the write; 409 dataset_mismatch asks for a reload, no auto retry. */

const loaded = { environment: "sandbox", datasetId: "loaded-dataset-A" } as const;
const later = { environment: "sandbox", datasetId: "other-dataset-B" } as const;

const configWith = (dataset: typeof orderEntryConfiguration.dataset): Handlers => ({
  "GET /order-entry/configuration": { body: { ...orderEntryConfiguration, dataset } },
});

const catalog = productsPage([product({ code: 2001, description: "Balão látex 9 pol. vermelho", listPrice: pricedList("12.5") })]);

const editorHandlers = (extra: Handlers = {}): Handlers => ({
  "GET /customers/:code": { body: customerDetail() },
  "GET /customers": { body: customersPage([customer()]) },
  "GET /products": { body: catalog },
  "GET /orders/:id": { body: orderDetail() },
  ...extra,
});

const customerPage = (extra: Handlers = {}): Handlers => ({
  "GET /customers/:code": { body: customerDetail() },
  "GET /orders": { body: ordersPage([]) },
  "GET /customers/:code/order-templates": { body: orderTemplatesPage([orderTemplate()]) },
  ...extra,
});

async function fillAndSave(user: ReturnType<typeof renderApp>["user"], qty = "2") {
  const produtos = await screen.findByRole("button", { name: "Produtos" });
  if (produtos.getAttribute("aria-pressed") !== "true") await user.click(produtos);
  const add = await screen.findByRole("button", { name: /^Adicionar .*Balão/ });
  await waitFor(() => expect(add).toBeEnabled());
  await user.click(add);
  await user.click(screen.getByRole("button", { name: /^Carrinho/ }));
  const quantity = await screen.findByLabelText("Quantidade de Balão látex 9 pol. vermelho");
  await user.clear(quantity);
  await user.type(quantity, qty);
  await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));
}

describe("Identidade da base de dados nas gravações", () => {
  it("create: sends the dataset the editor loaded under, not a later one", async () => {
    let configCalls = 0;
    const { user, calls } = renderApp("/pedidos/novo?customer=1001", {
      handlers: editorHandlers({
        "GET /order-entry/configuration": () => {
          configCalls += 1;
          return { body: { ...orderEntryConfiguration, dataset: configCalls === 1 ? loaded : later } };
        },
        "POST /orders": { status: 201, body: orderDetail() },
      }),
    });
    await fillAndSave(user);
    await waitFor(() => expect(callsTo(calls, "POST", "/orders")).toHaveLength(1));
    expect(callsTo(calls, "POST", "/orders")[0]?.body).toHaveProperty("expectedDataset", loaded);
  });

  it("replace: sends the loaded dataset", async () => {
    const { user, calls } = renderApp(`/pedidos/${ORDER_ID}`, {
      handlers: editorHandlers({ ...configWith(loaded), "PUT /orders/:id": { body: orderDetail({ version: 2 }) } }),
    });
    const quantity = await screen.findByLabelText("Quantidade de Balão látex 9 pol. vermelho");
    await user.clear(quantity);
    await user.type(quantity, "3");
    await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(callsTo(calls, "PUT", `/orders/${ORDER_ID}`)).toHaveLength(1));
    expect(callsTo(calls, "PUT", `/orders/${ORDER_ID}`)[0]?.body).toHaveProperty("expectedDataset", loaded);
  });

  it("repeat-last: sends the loaded dataset", async () => {
    const { user, calls } = renderApp("/clientes/1001", {
      handlers: customerPage({
        ...configWith(loaded),
        "POST /customers/:code/orders/repeat-last": { status: 201, body: { order: orderDetail(), skippedLines: [] } },
        "GET /orders/:id": { body: orderDetail() },
      }),
    });
    await user.click(await screen.findByRole("button", { name: "Repetir último pedido" }));
    await waitFor(() => expect(callsTo(calls, "POST", "/customers/1001/orders/repeat-last")).toHaveLength(1));
    expect(callsTo(calls, "POST", "/customers/1001/orders/repeat-last")[0]?.body).toHaveProperty("expectedDataset", loaded);
  });

  it("template use: sends the loaded dataset", async () => {
    const { user, calls } = renderApp("/clientes/1001", {
      handlers: customerPage({
        ...configWith(loaded),
        "POST /order-templates/:id/use": { status: 201, body: { order: orderDetail(), skippedLines: [] } },
        "GET /orders/:id": { body: orderDetail() },
      }),
    });
    await user.click(await screen.findByRole("button", { name: "Usar modelo Reposição mensal" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST" && c.path.endsWith("/use"))).toHaveLength(1));
    expect(calls.find((c) => c.method === "POST" && c.path.endsWith("/use"))?.body).toHaveProperty("expectedDataset", loaded);
  });

  describe("configuration without a dataset (null)", () => {
    it("blocks save: shows a clear error and sends nothing", async () => {
      const { user, calls } = renderApp("/pedidos/novo?customer=1001", { handlers: editorHandlers(configWith(null)) });
      await fillAndSave(user);
      expect(await screen.findByText("Base de dados não identificada")).toBeInTheDocument();
      expect(callsTo(calls, "POST", "/orders")).toHaveLength(0);
    });

    it("blocks repeat-last and template use: clear error, no request", async () => {
      const { user, calls } = renderApp("/clientes/1001", { handlers: customerPage(configWith(null)) });
      await user.click(await screen.findByRole("button", { name: "Repetir último pedido" }));
      expect(await screen.findByText("Base de dados não identificada")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Usar modelo Reposição mensal" }));
      await waitFor(() => expect(screen.getAllByText("Base de dados não identificada").length).toBe(2));
      expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    });
  });

  describe("409 dataset_mismatch", () => {
    const mismatch = apiError(409, "dataset_mismatch", "dataset", { requestId: "req-ds-1" });

    it("save: asks the user to reload and does not retry by itself", async () => {
      const { user, calls } = renderApp("/pedidos/novo?customer=1001", {
        handlers: editorHandlers({ "POST /orders": mismatch }),
      });
      await fillAndSave(user);
      expect(await screen.findByText("Os dados desta tela estão desatualizados")).toBeInTheDocument();
      expect(screen.getByText(/Recarregue a página/)).toBeInTheDocument();
      expect(screen.getByText("req-ds-1")).toBeInTheDocument();
      expect(callsTo(calls, "POST", "/orders")).toHaveLength(1);
    });

    it("repeat-last: shows the reload message, one request only", async () => {
      const { user, calls } = renderApp("/clientes/1001", {
        handlers: customerPage({ "POST /customers/:code/orders/repeat-last": mismatch }),
      });
      await user.click(await screen.findByRole("button", { name: "Repetir último pedido" }));
      expect(await screen.findByText("Os dados desta tela estão desatualizados")).toBeInTheDocument();
      expect(callsTo(calls, "POST", "/customers/1001/orders/repeat-last")).toHaveLength(1);
    });

    it("template use: shows the reload message", async () => {
      const { user } = renderApp("/clientes/1001", { handlers: customerPage({ "POST /order-templates/:id/use": mismatch }) });
      await user.click(await screen.findByRole("button", { name: "Usar modelo Reposição mensal" }));
      expect(await screen.findByText("Os dados desta tela estão desatualizados")).toBeInTheDocument();
    });
  });
});
