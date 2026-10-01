import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ORDER_ID, customer, customerDetail, customersPage, dashboard, ordersPage, orderDetail, orderItem, orderListItem, productsPage, testDataset } from "../test/fixtures";
import { apiError, callsTo, openUserMenu, renderApp, session, type Handlers } from "../test/harness";

/** Web parity with the operational flow: duplicate order, profile page, explicit data reload, honest status wording. */

const NEW_ID = "0190a000-0000-7000-8000-0000000000dd";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const editorHandlers = (order = orderDetail(), extra: Handlers = {}): Handlers => ({
  "GET /orders/:id": { body: order },
  "GET /products": { body: productsPage([]) },
  "GET /customers/:code": { body: customerDetail() },
  "GET /customers": { body: customersPage([customer()]) },
  ...extra,
});

const twoLines = () =>
  orderDetail({
    negotiationTypeCode: 3,
    notes: "Entregar pela manhã",
    items: [
      orderItem({ lineNo: 1, productCode: 2001, quantity: "2", discountPercent: "10" }),
      orderItem({ lineNo: 2, productCode: 2002, productDescription: "Vela aniversário", quantity: "4.5" }),
    ],
  });

describe("Pedido: Duplicar pedido", () => {
  it("creates a new draft from product + quantity only (no price, discount or notes) and opens it", async () => {
    const { user, calls, router } = renderApp(`/pedidos/${ORDER_ID}`, {
      handlers: editorHandlers(twoLines(), {
        "POST /orders": { status: 201, body: orderDetail({ id: NEW_ID, draftNumber: 13 }) },
      }),
    });
    await user.click(await screen.findByRole("button", { name: "Duplicar pedido" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/pedidos/${NEW_ID}`));

    const [request] = callsTo(calls, "POST", "/orders");
    const body = request?.body as Record<string, unknown>;
    expect(body.customerCode).toBe(1001);
    expect(body.negotiationTypeCode).toBe(3);
    expect(body.notes).toBeNull();
    expect(body.expectedDataset).toEqual(testDataset);
    expect(body.clientRequestId).toMatch(UUID);
    expect(body.items).toEqual([
      { productCode: 2001, quantity: "2" },
      { productCode: 2002, quantity: "4.5" },
    ]);
    expect(JSON.stringify(body)).not.toMatch(/unitListPrice|estimated|discount/i);
  });

  it("is also offered for an order that is no longer a draft", async () => {
    renderApp(`/pedidos/${ORDER_ID}`, { handlers: editorHandlers(orderDetail({ status: "sent", erpNumber: 555 })) });
    expect(await screen.findByRole("button", { name: "Duplicar pedido" })).toBeEnabled();
  });

  it("reuses the request id after a lost response and uses a new one after a definitive answer", async () => {
    let attempt = 0;
    const { user, calls } = renderApp(`/pedidos/${ORDER_ID}`, {
      handlers: editorHandlers(orderDetail(), {
        "POST /orders": () => {
          attempt += 1;
          if (attempt === 1) return apiError(503, "service_unavailable", "x");
          return apiError(409, "conflict", "Cliente indisponível");
        },
      }),
    });
    const click = async () => user.click(await screen.findByRole("button", { name: "Duplicar pedido" }));
    await click();
    expect(await screen.findByText("Serviço indisponível")).toBeInTheDocument();
    await click();
    await waitFor(() => expect(callsTo(calls, "POST", "/orders")).toHaveLength(2));
    await click();
    await waitFor(() => expect(callsTo(calls, "POST", "/orders")).toHaveLength(3));
    const ids = callsTo(calls, "POST", "/orders").map((call) => (call.body as { clientRequestId: string }).clientRequestId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[1]);
  });

  it("names the refused products, creates nothing, and offers the copy without them", async () => {
    let attempt = 0;
    const { user, calls, router } = renderApp(`/pedidos/${ORDER_ID}`, {
      handlers: editorHandlers(twoLines(), {
        "POST /orders": () => {
          attempt += 1;
          if (attempt === 1) {
            return apiError(422, "validation_failed", "x", { issues: [{ path: "items[1]", code: "product_not_sellable", message: "x" }] });
          }
          return { status: 201, body: orderDetail({ id: NEW_ID, items: [orderItem()] }) };
        },
      }),
    });
    await user.click(await screen.findByRole("button", { name: "Duplicar pedido" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Alguns itens não podem ser pedidos agora");
    expect(alert).toHaveTextContent("Vela aniversário (código 2002)");
    expect(alert).toHaveTextContent("Produto indisponível para venda.");
    expect(router.state.location.pathname).toBe(`/pedidos/${ORDER_ID}`);

    await user.click(within(alert).getByRole("button", { name: "Duplicar sem esses itens" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/pedidos/${NEW_ID}`));
    const second = callsTo(calls, "POST", "/orders")[1]?.body as { items: unknown[] };
    expect(second.items).toEqual([{ productCode: 2001, quantity: "2" }]);
    expect(await screen.findByText("Rascunho criado a partir do pedido")).toBeInTheDocument();
  });

  it("does not offer to drop lines when the problem is not about the products", async () => {
    const { user } = renderApp(`/pedidos/${ORDER_ID}`, {
      handlers: editorHandlers(orderDetail(), {
        "POST /orders": apiError(409, "customer_ineligible", "O cliente está bloqueado."),
      }),
    });
    await user.click(await screen.findByRole("button", { name: "Duplicar pedido" }));
    expect(await screen.findByText("O cliente está bloqueado.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Duplicar sem esses itens" })).not.toBeInTheDocument();
  });
});

describe("Meu perfil e atualização de dados", () => {
  const shell = { "GET /dashboard": { body: dashboard() }, "GET /orders": { body: ordersPage([]) } };

  it("opens the profile from the user menu and shows the account from the session, read-only", async () => {
    const { user, router } = renderApp("/", { handlers: shell });
    await openUserMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Meu perfil" }));
    expect(await screen.findByText("Perfil de acesso")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/perfil");
    expect(screen.getByText("Vendedores vinculados")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Meu perfil — Sales Force"));
  });

  it("says plainly when the account has no seller link", async () => {
    const base = session(true);
    const body = base.body as { account: Record<string, unknown> };
    renderApp("/perfil", { handlers: { ...shell, "GET /auth/session": { body: { ...body, account: { ...body.account, sellerCodes: [] } } } } });
    expect(await screen.findByText("Nenhum vendedor vinculado")).toBeInTheDocument();
  });

  it("reloads the data on screen from the API and confirms", async () => {
    const { user, calls } = renderApp("/", { handlers: shell });
    await waitFor(() => expect(callsTo(calls, "GET", "/dashboard")).toHaveLength(1));
    await openUserMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Atualizar dados" }));
    expect(await screen.findByText("Dados atualizados")).toBeInTheDocument();
    expect(callsTo(calls, "GET", "/dashboard").length).toBeGreaterThanOrEqual(2);
  });

  it("reports a failed reload instead of claiming success", async () => {
    let fail = false;
    const { user, calls } = renderApp("/", {
      handlers: { ...shell, "GET /dashboard": () => (fail ? apiError(503, "service_unavailable", "x") : { body: dashboard() }) },
    });
    await waitFor(() => expect(callsTo(calls, "GET", "/dashboard")).toHaveLength(1));
    fail = true;
    await openUserMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Atualizar dados" }));
    expect(await screen.findByText("Não foi possível atualizar os dados")).toBeInTheDocument();
    expect(screen.queryByText("Dados atualizados")).not.toBeInTheDocument();
  });
});

describe("Situação do pedido: textos distintos e honestos", () => {
  const idFor = (n: number) => `0190a000-0000-7000-8000-0000000000a${n}`;
  const rows = [
    orderListItem({ id: idFor(1), draftNumber: 1, status: "draft" }),
    orderListItem({ id: idFor(2), draftNumber: 2, status: "queued" }),
    orderListItem({ id: idFor(3), draftNumber: 3, status: "sent", erpNumber: 555 }),
    orderListItem({ id: idFor(4), draftNumber: 4, status: "rejected" }),
    orderListItem({ id: idFor(5), draftNumber: 5, status: "unknown" }),
    orderListItem({ id: idFor(6), draftNumber: 6, status: "cancelled" }),
  ];

  it("shows one distinct text per status and never says invoiced or synchronized", async () => {
    renderApp("/pedidos", { handlers: { "GET /orders": { body: ordersPage(rows) } } });
    const table = await screen.findByRole("table");
    for (const text of ["Na fila de envio ao ERP", "Enviado ao ERP", "Rejeitado no envio ao ERP", "Situação desconhecida", "Descartado"]) {
      expect(await within(table).findAllByText(text)).not.toHaveLength(0);
    }
    expect(table).not.toHaveTextContent(/faturad|sincronizado|confirmado/i);
  });

  it("explains in the editor that sent is not billing", async () => {
    renderApp(`/pedidos/${ORDER_ID}`, { handlers: editorHandlers(orderDetail({ status: "sent", erpNumber: 555 })) });
    expect(await screen.findByText(/Isso não indica confirmação nem faturamento/)).toBeInTheDocument();
  });

  it("marks a draft whose customer became ineligible and blocks sending, without changing its status", async () => {
    const review = { status: "needs_review", reason: "customer_ineligible", customerBlock: "customer_blocked" } as const;
    renderApp(`/pedidos/${ORDER_ID}`, { handlers: editorHandlers(orderDetail({ review })) });
    expect(await screen.findByText("O cliente deste rascunho está bloqueado.", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar ao ERP" })).toBeDisabled();
    expect(screen.getAllByText("Rascunho").length).toBeGreaterThan(0);
  });

  it("flags the review in the list next to the status", async () => {
    const review = { status: "needs_review", reason: "customer_ineligible", customerBlock: "customer_inactive" } as const;
    renderApp("/pedidos", { handlers: { "GET /orders": { body: ordersPage([orderListItem({ review })]) } } });
    expect(await screen.findByText("Requer revisão")).toBeInTheDocument();
    expect(screen.getAllByText("Rascunho").length).toBeGreaterThan(0);
  });
});
