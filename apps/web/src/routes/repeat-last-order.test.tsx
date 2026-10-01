import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ORDER_ID, customerDetail, orderDetail, ordersPage, testDataset } from "../test/fixtures";
import { apiError, callsTo, renderApp, type Handlers, type MockRequest } from "../test/harness";

/** "Repetir último pedido" (Fase C, plan §25.9): reachable from the customer page in one click. Only product +
 * quantity are copied from the customer's most recent NON-cancelled order recorded in Sales Force (never from
 * Sankhya/ERP history); prices and totals are always recomputed server-side. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const customerPageHandlers = (extra: Handlers = {}): Handlers => ({
  "GET /customers/:code": { body: customerDetail() },
  "GET /orders": { body: ordersPage([]) },
  "GET /customers/:code/order-templates": { body: { items: [] } },
  ...extra,
});

const repeatIds = (calls: MockRequest[]) =>
  callsTo(calls, "POST", "/customers/1001/orders/repeat-last").map((call) => (call.body as { clientRequestId: string }).clientRequestId);

describe("Cliente: Repetir último pedido", () => {
  it("is reachable from the customer page next to Novo pedido", async () => {
    renderApp("/clientes/1001", { handlers: customerPageHandlers() });
    // "Novo pedido" is a Button rendered `asChild` around a router Link, so its accessible role is "link", not
    // "button".
    expect(await screen.findByRole("link", { name: "Novo pedido" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Repetir último pedido" })).toBeInTheDocument();
  });

  it("creates a draft with only a fresh clientRequestId, opens it, shows a toast and no notice when nothing was skipped", async () => {
    const { user, calls, router } = renderApp("/clientes/1001", {
      handlers: customerPageHandlers({
        "POST /customers/:code/orders/repeat-last": {
          status: 201,
          body: { order: orderDetail(), skippedLines: [] },
        },
        "GET /orders/:id": { body: orderDetail() },
      }),
    });
    await user.click(await screen.findByRole("button", { name: "Repetir último pedido" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/pedidos/${ORDER_ID}`));

    const [request] = callsTo(calls, "POST", "/customers/1001/orders/repeat-last");
    expect(Object.keys(request?.body as object).sort()).toEqual(["clientRequestId", "expectedDataset"]);
      expect((request?.body as { expectedDataset: unknown }).expectedDataset).toEqual(testDataset);
    expect((request?.body as { clientRequestId: string }).clientRequestId).toMatch(UUID);

    expect(await screen.findByText("Rascunho criado a partir do último pedido registrado no Sales Force")).toBeInTheDocument();
    expect(screen.queryByRole("alert", { name: "Itens do modelo que ficaram de fora" })).not.toBeInTheDocument();
  });

  it("opens the draft with a page notice and no toast when lines were skipped", async () => {
    const { user, router } = renderApp("/clientes/1001", {
      handlers: customerPageHandlers({
        "POST /customers/:code/orders/repeat-last": {
          status: 201,
          body: {
            order: orderDetail(),
            skippedLines: [
              { lineNo: 2, productCode: 2003, reason: "product_removed" },
              { lineNo: 3, productCode: 2004, reason: "no_price" },
            ],
          },
        },
        "GET /orders/:id": { body: orderDetail() },
      }),
    });
    await user.click(await screen.findByRole("button", { name: "Repetir último pedido" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/pedidos/${ORDER_ID}`));

    const notice = await screen.findByRole("alert", { name: "Itens do modelo que ficaram de fora" });
    expect(notice).toHaveTextContent("2 itens do modelo não entraram no pedido");
    expect(notice).toHaveTextContent("último pedido registrado no Sales Force");
    expect(notice).toHaveTextContent("Código 2003: Produto removido do catálogo");
    expect(notice).toHaveTextContent("Código 2004: Produto sem preço para este cliente");
    expect(screen.queryByText("Rascunho criado a partir do último pedido registrado no Sales Force")).not.toBeInTheDocument();
  });

  it("shows an informational, non-danger alert with the honest Sales Force wording on 409 no_previous_order, and creates nothing", async () => {
    const { user, calls, router } = renderApp("/clientes/1001", {
      handlers: customerPageHandlers({
        "POST /customers/:code/orders/repeat-last": apiError(409, "conflict", "Nenhum pedido anterior", {
          details: { reason: "no_previous_order" },
        }),
      }),
    });
    await user.click(await screen.findByRole("button", { name: "Repetir último pedido" }));
    const alert = await screen.findByText("Nenhum pedido registrado no Sales Force para este cliente ainda");
    expect(alert.closest('[role="status"]')).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/clientes/1001");
    expect(callsTo(calls, "POST", "/customers/1001/orders/repeat-last")).toHaveLength(1);
    // The button stays available: nothing is disabled preemptively.
    expect(screen.getByRole("button", { name: "Repetir último pedido" })).toBeEnabled();
  });

  it("explains a 409 no_usable_lines, lists why, creates nothing and stays on the page", async () => {
    const { user, router } = renderApp("/clientes/1001", {
      handlers: customerPageHandlers({
        "POST /customers/:code/orders/repeat-last": apiError(409, "conflict", "Nenhum item", {
          details: { reason: "no_usable_lines", skippedLines: [{ lineNo: 1, productCode: 2001, reason: "product_inactive" }] },
        }),
      }),
    });
    await user.click(await screen.findByRole("button", { name: "Repetir último pedido" }));
    expect(await screen.findByText("Nenhum item do último pedido pode ser pedido agora")).toBeInTheDocument();
    expect(screen.getByText(/Nenhum pedido foi criado/)).toBeInTheDocument();
    expect(screen.getByText(/Código 2001: Produto inativo/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/clientes/1001");
  });

  it("refreshes the customer when it is out of scope (404)", async () => {
    const { user, calls } = renderApp("/clientes/1001", {
      handlers: customerPageHandlers({ "POST /customers/:code/orders/repeat-last": apiError(404, "not_found", "x") }),
    });
    await user.click(await screen.findByRole("button", { name: "Repetir último pedido" }));
    expect(await screen.findByText("Não encontrado")).toBeInTheDocument();
    await waitFor(() => expect(callsTo(calls, "GET", "/customers/1001")).toHaveLength(2));
  });

  it("reuses the request id after a network error, a 5xx and a 429, and uses a new one after success", async () => {
    let attempt = 0;
    const { user, calls, router } = renderApp("/clientes/1001", {
      handlers: customerPageHandlers({
        "POST /customers/:code/orders/repeat-last": () => {
          attempt += 1;
          if (attempt === 1) throw new TypeError("Failed to fetch");
          if (attempt === 2) return apiError(503, "service_unavailable", "x");
          if (attempt === 3) return apiError(429, "too_many_requests", "x");
          return { status: 201, body: { order: orderDetail(), skippedLines: [] } };
        },
        "GET /orders/:id": { body: orderDetail() },
      }),
    });
    const click = async () => user.click(await screen.findByRole("button", { name: "Repetir último pedido" }));
    await click();
    expect(await screen.findByText("Sem conexão com o servidor")).toBeInTheDocument();
    await click();
    expect(await screen.findByText("Serviço indisponível")).toBeInTheDocument();
    await click();
    expect(await screen.findByText("Muitas requisições")).toBeInTheDocument();
    await click();
    await waitFor(() => expect(router.state.location.pathname).toBe(`/pedidos/${ORDER_ID}`));

    const ids = repeatIds(calls);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(1);
  });

  it("uses a new request id for the next attempt after a definitive 409", async () => {
    let attempt = 0;
    const { user, calls } = renderApp("/clientes/1001", {
      handlers: customerPageHandlers({
        "POST /customers/:code/orders/repeat-last": () => {
          attempt += 1;
          if (attempt === 1) return apiError(409, "conflict", "x", { details: { reason: "no_previous_order" } });
          return { status: 201, body: { order: orderDetail(), skippedLines: [] } };
        },
        "GET /orders/:id": { body: orderDetail() },
      }),
    });
    await user.click(await screen.findByRole("button", { name: "Repetir último pedido" }));
    await screen.findByText("Nenhum pedido registrado no Sales Force para este cliente ainda");
    await user.click(screen.getByRole("button", { name: "Repetir último pedido" }));
    await waitFor(() => expect(repeatIds(calls)).toHaveLength(2));
    const [first, second] = repeatIds(calls);
    expect(first).not.toBe(second);
  });

  it("shows the loading state on the button while the request is pending", async () => {
    let resolveRequest: (response: { status: number; body: unknown }) => void = () => {};
    const pending = new Promise<{ status: number; body: unknown }>((resolve) => {
      resolveRequest = resolve;
    });
    const { user } = renderApp("/clientes/1001", {
      handlers: customerPageHandlers({
        "POST /customers/:code/orders/repeat-last": () => pending,
        "GET /orders/:id": { body: orderDetail() },
      }),
    });
    const button = await screen.findByRole("button", { name: "Repetir último pedido" });
    await user.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAttribute("aria-busy", "true");
    resolveRequest({ status: 201, body: { order: orderDetail(), skippedLines: [] } });
  });
});
