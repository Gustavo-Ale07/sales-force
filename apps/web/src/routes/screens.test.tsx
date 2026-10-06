import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ORDER_ID,
  configuration,
  customer,
  customerDetail,
  customersPage,
  dashboard,
  integrationFake,
  noPriceList,
  orderListItem,
  ordersPage,
  pricedList,
  product,
  productDetail,
  productsPage,
  zeroList,
} from "../test/fixtures";
import { apiError, callsTo, renderApp } from "../test/harness";

const FORBIDDEN_TERMS = /custo|margem|cost|margin/i;

describe("Início (dashboard)", () => {
  it("shows a loading state, then the metrics with unavailable values marked as such", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    renderApp("/", {
      handlers: {
        "GET /dashboard": async () => {
          await gate;
          return { body: dashboard() };
        },
      },
    });
    expect(await screen.findByText("Carregando indicadores…")).toBeInTheDocument();
    release();
    // The KPI grid shows the compact tile labels (per the Início redesign), not each metric's own long label.
    expect(await screen.findByText("1.250")).toBeInTheDocument();
    // A metric the server could not provide is "not available", never a made-up zero.
    // It is not shown as a row of "Não disponível": one quiet note names it instead.
    expect(screen.getByTestId("indicators-without-data")).toHaveTextContent(/Sem dados nesta instalação:.*Indicadores de crédito/);
    expect(screen.getByText(/Escopo: Vendedor 7/)).toBeInTheDocument();
    expect(screen.getByText("Rascunho nº 12")).toBeInTheDocument();
  });

  it("marks demonstration data", async () => {
    const data = dashboard();
    const [group] = data.groups;
    renderApp("/", { handlers: { "GET /dashboard": { body: { ...data, groups: group ? [{ ...group, demo: true }] : [] } } } });
    expect(await screen.findByText("Dados de demonstração")).toBeInTheDocument();
  });

  it("shows the empty state when there is nothing to show", async () => {
    renderApp("/", { handlers: { "GET /dashboard": { body: dashboard({ groups: [], recentOrders: [] }) } } });
    expect(await screen.findByText("Sem indicadores ainda")).toBeInTheDocument();
  });

  it("shows a recoverable error with the correlation id and retries", async () => {
    let attempts = 0;
    const { user } = renderApp("/", {
      handlers: {
        "GET /dashboard": () => {
          attempts += 1;
          return attempts === 1 ? apiError(503, "service_unavailable", "x", { requestId: "req-dash-1" }) : { body: dashboard() };
        },
      },
    });
    expect(await screen.findByText("Serviço indisponível")).toBeInTheDocument();
    expect(screen.getByText("req-dash-1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Tentar novamente/ }));
    expect(await screen.findByText("1.250")).toBeInTheDocument();
  });

  it("shows the forbidden state on 403", async () => {
    renderApp("/", { handlers: { "GET /dashboard": apiError(403, "forbidden", "x") } });
    expect(await screen.findByText("Sem permissão")).toBeInTheDocument();
  });
});

describe("Carteira (customers)", () => {
  it("lists customers with formatted document and status, and opens the customer from the keyboard", async () => {
    const { user, router } = renderApp("/clientes", {
      handlers: { "GET /customers": { body: customersPage([customer(), customer({ code: 1002, name: "Beta Ltda", blocked: true, document: "12345678909" })]) } },
    });
    expect(await screen.findByText("Comercial Alfa Ltda")).toBeInTheDocument();
    expect(screen.getByText("11.222.333/0001-81")).toBeInTheDocument();
    expect(screen.getByText("123.456.789-09")).toBeInTheDocument();
    expect(screen.getByText("Bloqueado")).toBeInTheDocument();
    const row = screen.getByText("Comercial Alfa Ltda").closest("tr");
    row?.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(router.state.location.pathname).toBe("/clientes/1001"));
  });

  it("offers a new order for the customer straight from the row, without opening the customer", async () => {
    const { user, router } = renderApp("/clientes", { handlers: { "GET /customers": { body: customersPage([customer()]) } } });
    const action = await screen.findByRole("link", { name: "Novo pedido para Comercial Alfa Ltda" });
    expect(action).toHaveAttribute("href", expect.stringContaining("customer=1001"));
    await user.click(action);
    await waitFor(() => expect(router.state.location.pathname).toBe("/pedidos/novo"));
    expect(router.state.location.search).toEqual({ customer: 1001 });
  });

  it("shows skeleton rows while loading", async () => {
    renderApp("/clientes", { handlers: { "GET /customers": () => new Promise(() => undefined) } });
    expect(await screen.findByRole("heading", { name: "Clientes", level: 1 })).toBeInTheDocument();
    expect(document.querySelector("[aria-busy='true']")).not.toBeNull();
  });

  it("shows the empty state for an empty portfolio", async () => {
    renderApp("/clientes", { handlers: { "GET /customers": { body: customersPage([]) } } });
    expect(await screen.findByText("Nenhum cliente na carteira")).toBeInTheDocument();
  });

  it("shows the filtered-empty state with a way to clear the filters", async () => {
    const { user, router } = renderApp("/clientes?search=zzz", { handlers: { "GET /customers": { body: customersPage([]) } } });
    expect(await screen.findByText("Nenhum cliente encontrado")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Limpar filtros" }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
  });

  it("sends the search and filters to the server and keeps them in the URL", async () => {
    const { user, calls, router } = renderApp("/clientes", { handlers: { "GET /customers": { body: customersPage([customer()]) } } });
    await screen.findByText("Comercial Alfa Ltda");
    await user.type(screen.getByRole("searchbox", { name: /Buscar cliente/ }), "alfa");
    await waitFor(() => expect(callsTo(calls, "GET", "/customers").some((call) => call.search.get("search") === "alfa")).toBe(true));
    expect(router.state.location.search).toMatchObject({ search: "alfa" });
  });

  it("shows the error state with the correlation id", async () => {
    renderApp("/clientes", { handlers: { "GET /customers": apiError(500, "internal_error", "x", { requestId: "req-c-1" }) } });
    expect(await screen.findByText("req-c-1")).toBeInTheDocument();
  });

  it("shows the forbidden state on 403", async () => {
    renderApp("/clientes", { handlers: { "GET /customers": apiError(403, "forbidden", "x") } });
    expect(await screen.findByText("Sem permissão")).toBeInTheDocument();
  });

  it("does not offer a seller filter when the account has a single seller in view", async () => {
    renderApp("/clientes", { handlers: { "GET /customers": { body: customersPage([customer()]) }, "GET /sellers": { body: { items: [{ code: 7, name: "Vendedor Sete", active: true }] } } } });
    await screen.findByText("Comercial Alfa Ltda");
    expect(screen.queryByLabelText("Vendedor")).not.toBeInTheDocument();
  });
});

describe("Cliente (customer detail)", () => {
  it("shows the registration, the price table and credit limit as not available when the server omits it", async () => {
    const { user } = renderApp("/clientes/1001", {
      handlers: { "GET /customers/:code": { body: customerDetail() }, "GET /orders": { body: ordersPage([orderListItem()]) } },
    });
    expect(await screen.findByRole("heading", { name: /Comercial Alfa Ltda/ })).toBeInTheDocument();
    expect(screen.getByText("11.222.333/0001-81")).toBeInTheDocument();
    expect(screen.getByText("5 — Tabela Varejo")).toBeInTheDocument();
    expect(screen.getByText("Tabela 5 (do cliente)")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Financeiro/ }));
    expect(screen.getByText("Limite de crédito", { selector: "dt" }).closest("div")).toHaveTextContent("Não disponível");
    await user.click(screen.getByRole("tab", { name: /Vendas/ }));
    expect(await screen.findByText("Rascunho nº 12")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Novo pedido/ })).toHaveAttribute("href", expect.stringContaining("customer=1001"));
  });

  it("shows the credit limit only when the server sent it", async () => {
    const { user } = renderApp("/clientes/1001", {
      handlers: { "GET /customers/:code": { body: customerDetail({ creditLimit: "5000" }) }, "GET /orders": { body: ordersPage([]) } },
    });
    await user.click(await screen.findByRole("tab", { name: /Financeiro/ }));
    expect(await screen.findByText(/5\.000,00/)).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Vendas/ }));
    expect(await screen.findByText("Nenhum pedido para este cliente")).toBeInTheDocument();
  });

  it("shows a customer without a resolved price table", async () => {
    renderApp("/clientes/1001", {
      handlers: {
        "GET /customers/:code": { body: customerDetail({ priceTableCode: null, priceTableName: null, resolvedPriceTable: null }) },
        "GET /orders": { body: ordersPage([]) },
      },
    });
    expect(await screen.findByText("Sem tabela")).toBeInTheDocument();
    expect(screen.getByText(/Sem tabela resolvida/)).toBeInTheDocument();
  });

  it("shows not found for a customer outside the scope (404) and no data", async () => {
    renderApp("/clientes/9", { handlers: { "GET /customers/:code": apiError(404, "not_found", "x") } });
    expect(await screen.findByText("Não encontrado")).toBeInTheDocument();
  });

  it("shows the forbidden state on 403", async () => {
    renderApp("/clientes/9", { handlers: { "GET /customers/:code": apiError(403, "forbidden", "x") } });
    expect(await screen.findByText("Sem permissão")).toBeInTheDocument();
  });
});

describe("Catálogo (products)", () => {
  const groups = { "GET /product-groups": { body: { items: [{ code: 30, name: "Balões" }] } } };

  it("shows 'Sem preço' for a product without price, never zero, and marks an explicit zero price distinctly", async () => {
    renderApp("/produtos", {
      handlers: {
        ...groups,
        "GET /products": {
          body: productsPage([
            product({ code: 1, description: "Produto com preço", listPrice: pricedList("12.5") }),
            product({ code: 2, description: "Produto sem preço", listPrice: noPriceList("no_price_row") }),
            product({ code: 3, description: "Produto preço zero", listPrice: zeroList() }),
          ]),
        },
      },
    });
    const rowOf = async (text: string) => (await screen.findByText(text)).closest("tr") as HTMLElement;
    expect(await rowOf("Produto com preço")).toHaveTextContent("12,50");
    const noPriceRow = await rowOf("Produto sem preço");
    expect(noPriceRow).toHaveTextContent("Sem preço");
    expect(noPriceRow).not.toHaveTextContent(/0,00/);
    const zeroRow = await rowOf("Produto preço zero");
    expect(zeroRow).toHaveTextContent("Preço zero");
  });

  it("explains where the prices come from", async () => {
    renderApp("/produtos", { handlers: { ...groups, "GET /products": { body: productsPage([product()]) } } });
    expect(await screen.findByText("Origem dos preços")).toBeInTheDocument();
  });

  it("asks for prices of the chosen customer via the customerCode parameter", async () => {
    const { calls } = renderApp("/produtos?customerCode=1001", { handlers: { ...groups, "GET /products": { body: productsPage([product()]) }, "GET /customers/:code": { body: customerDetail() } } });
    await screen.findByText("Balão látex 9 pol. vermelho");
    expect(callsTo(calls, "GET", "/products")[0]?.search.get("customerCode")).toBe("1001");
  });

  it("lists thumbnails only (with the version), and a placeholder for a product without image", async () => {
    const image = { version: "h1", thumbnailUrl: "/api/v1/products/2001/image?variant=thumb", url: "/api/v1/products/2001/image?variant=full" };
    renderApp("/produtos", {
      handlers: { ...groups, "GET /products": { body: productsPage([product({ image }), product({ code: 2002, description: "Vela lisa" })]) } },
    });
    const img = await screen.findByRole("img", { name: "Balão látex 9 pol. vermelho" });
    expect(img).toHaveAttribute("src", "/api/v1/products/2001/image?variant=thumb&v=h1");
    const row = screen.getByText("Vela lisa").closest("tr") as HTMLElement;
    expect(within(row).queryByRole("img")).toBeNull();
    expect(within(row).getByText("VL")).toBeInTheDocument();
    expect(document.querySelectorAll('img[src*="variant=full"]')).toHaveLength(0);
  });

  it("renders neither cost nor margin anywhere", async () => {
    renderApp("/produtos", { handlers: { ...groups, "GET /products": { body: productsPage([product()]) } } });
    await screen.findByText("Balão látex 9 pol. vermelho");
    expect(document.body.textContent).not.toMatch(FORBIDDEN_TERMS);
  });

  it("opens the detail panel from the row and shows the price source", async () => {
    const { user } = renderApp("/produtos", {
      handlers: { ...groups, "GET /products": { body: productsPage([product()]) }, "GET /products/:code": { body: productDetail() } },
    });
    await user.click(await screen.findByText("Balão látex 9 pol. vermelho"));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Preço de lista")).toBeInTheDocument();
    expect(within(dialog).getByText("BL-09-VM")).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(FORBIDDEN_TERMS);
  });

  it("shows the empty and error states", async () => {
    renderApp("/produtos", { handlers: { ...groups, "GET /products": { body: productsPage([]) } } });
    expect(await screen.findByText("Catálogo vazio")).toBeInTheDocument();
  });

  it("shows the error state with the correlation id", async () => {
    renderApp("/produtos", { handlers: { ...groups, "GET /products": apiError(500, "internal_error", "x", { requestId: "req-p-1" }) } });
    expect(await screen.findByText("req-p-1")).toBeInTheDocument();
  });
});

describe("Rascunhos (orders)", () => {
  it("lists drafts with total and status and opens one", async () => {
    const { user, router } = renderApp("/pedidos", {
      handlers: { "GET /orders": { body: ordersPage([orderListItem(), orderListItem({ id: "0190a000-0000-7000-8000-0000000000bb", draftNumber: 13, isPartial: true, status: "cancelled" })]) } },
    });
    expect(await screen.findByText("Rascunho nº 12")).toBeInTheDocument();
    expect(screen.getByText("(parcial)")).toBeInTheDocument();
    await user.click(screen.getByText("Rascunho nº 12"));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/pedidos/${ORDER_ID}`));
  });

  it("offers discard only for drafts", async () => {
    renderApp("/pedidos", { handlers: { "GET /orders": { body: ordersPage([orderListItem(), orderListItem({ id: "0190a000-0000-7000-8000-0000000000bb", draftNumber: 13, status: "sent", erpNumber: 555 })]) } } });
    expect(await screen.findByText("Rascunho nº 12")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Descartar/ })).toHaveLength(1);
    expect(screen.getByText("Pedido 555")).toBeInTheDocument();
  });

  it("discards a draft after confirmation and refreshes the list", async () => {
    let discarded = false;
    const { user, calls } = renderApp("/pedidos", {
      handlers: {
        "GET /orders": () => ({ body: ordersPage(discarded ? [] : [orderListItem()]) }),
        "DELETE /orders/:id": () => {
          discarded = true;
          return { body: { ...orderListItem({ status: "cancelled" }), negotiationTypeCode: null, notes: null, items: [], totals: { estimatedTotal: "0", lineCount: 0, unpricedLineCount: 0, isPartial: false } } };
        },
      },
    });
    await user.click(await screen.findByRole("button", { name: "Descartar Rascunho nº 12" }));
    const dialog = await screen.findByRole("dialog", { name: "Descartar rascunho?" });
    await user.click(within(dialog).getByRole("button", { name: "Descartar" }));
    expect(await screen.findByText("Nenhum pedido ainda")).toBeInTheDocument();
    expect(callsTo(calls, "DELETE", `/orders/${ORDER_ID}`)).toHaveLength(1);
  });

  it("keeps the draft and shows the error with the correlation id when discarding fails", async () => {
    const { user } = renderApp("/pedidos", {
      handlers: {
        "GET /orders": { body: ordersPage([orderListItem()]) },
        "DELETE /orders/:id": apiError(409, "order_not_editable", "Pedido não pode ser descartado.", { requestId: "req-d-1" }),
      },
    });
    await user.click(await screen.findByRole("button", { name: "Descartar Rascunho nº 12" }));
    const dialog = await screen.findByRole("dialog", { name: "Descartar rascunho?" });
    await user.click(within(dialog).getByRole("button", { name: "Descartar" }));
    expect(await within(dialog).findByText("req-d-1")).toBeInTheDocument();
  });

  it("shows the creation date and filters by customer through the selector, sending only the code", async () => {
    const { user, calls } = renderApp("/pedidos", {
      handlers: {
        "GET /orders": { body: ordersPage([orderListItem()]) },
        "GET /customers": { body: customersPage([customer(), customer({ code: 1002, name: "Beta Ltda" })]) },
        "GET /customers/:code": { body: customerDetail({ code: 1002, name: "Beta Ltda" }) },
      },
    });
    expect(await screen.findByRole("heading", { name: "Vendas" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Data" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Filtrar por cliente/ }));
    await user.click(await screen.findByRole("button", { name: /Beta Ltda/ }));
    await waitFor(() => expect(callsTo(calls, "GET", "/orders").some((call) => call.search.get("customerCode") === "1002")).toBe(true));
    expect(await screen.findByRole("button", { name: /Filtrar por cliente/ })).toHaveTextContent("Beta Ltda");
  });

  it("shows the empty and error states", async () => {
    const empty = renderApp("/pedidos", { handlers: { "GET /orders": { body: ordersPage([]) } } });
    expect(await screen.findByText("Nenhum pedido ainda")).toBeInTheDocument();
    empty.unmount();
    renderApp("/pedidos", { handlers: { "GET /orders": apiError(500, "internal_error", "x", { requestId: "req-o-1" }) } });
    expect(await screen.findByText("req-o-1")).toBeInTheDocument();
  });
});

describe("Integração", () => {
  it("shows the read-only configuration and marks fake-gateway data as demonstration", async () => {
    renderApp("/integracao", { role: "admin" });
    expect(await screen.findByText("Dados de demonstração")).toBeInTheDocument();
    expect(screen.getByText("Demonstração (dados de exemplo)")).toBeInTheDocument();
    expect(screen.getByText("Sincronização por entidade", { selector: "caption" })).toBeInTheDocument();
    expect(screen.getByText("customers")).toBeInTheDocument();
  });

  it("shows failing entities when the integration is degraded", async () => {
    renderApp("/integracao", {
      role: "admin",
      handlers: {
        "GET /configuration": {
          body: {
            ...configuration,
            gateway: { mode: "live" },
            integration: { ...integrationFake, state: "degraded", gatewayMode: "live", failingEntities: ["products"] },
            syncStates: [],
          },
        },
      },
    });
    expect(await screen.findByText("Degradada")).toBeInTheDocument();
    expect(screen.getByText("products")).toBeInTheDocument();
    expect(screen.getByText("Sem sincronizações registradas")).toBeInTheDocument();
    expect(screen.queryByText("Dados de demonstração")).not.toBeInTheDocument();
  });

  it("shows the error state", async () => {
    renderApp("/integracao", { role: "admin", handlers: { "GET /configuration": apiError(500, "internal_error", "x", { requestId: "req-i-1" }) } });
    expect(await screen.findByText("req-i-1")).toBeInTheDocument();
  });
});
