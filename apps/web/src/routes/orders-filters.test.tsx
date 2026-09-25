import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { asDate, asIntList } from "../lib/search-params";
import { MAX_ORDER_PRODUCTS, parseOrdersSearch } from "../lib/route-search";
import { customer, customerDetail, customersPage, orderListItem, ordersPage, priceContext, product, productDetail, productsPage } from "../test/fixtures";
import { callsTo, renderApp, type Handlers } from "../test/harness";

const CABO = product({ code: 12, description: "CABO FLEXIVEL 2,5 MM", reference: "CB-25" });
const BALAO = product({ code: 34, description: "BALAO LATEX 9 POL", reference: "BL-09" });

const handlers = (overrides: Handlers = {}): Handlers => ({
  "GET /orders": { body: ordersPage([orderListItem()]) },
  "GET /customers": { body: customersPage([customer(), customer({ code: 1002, name: "Beta Ltda" })]) },
  "GET /customers/:code": { body: customerDetail({ code: 1002, name: "Beta Ltda" }) },
  "GET /products": { body: productsPage([CABO, BALAO]) },
  "GET /products/:code": (request, params) => ({ body: productDetail(params["code"] === "34" ? { code: 34, description: BALAO.description } : { code: 12, description: CABO.description }) }),
  ...overrides,
});

const lastOrdersCall = (calls: ReturnType<typeof renderApp>["calls"]) => callsTo(calls, "GET", "/orders").at(-1)?.search;

describe("Vendas: filtros comerciais", () => {
  it("period: sends the dates as typed, keeps them in the URL and shows a chip; the date field can be switched", async () => {
    const { calls, router, user } = renderApp("/pedidos", { handlers: handlers() });
    await screen.findByText("Rascunho nº 12");
    fireEvent.change(screen.getByLabelText("Data inicial"), { target: { value: "2026-03-01" } });
    await waitFor(() => expect(lastOrdersCall(calls)?.get("from")).toBe("2026-03-01"));
    fireEvent.change(screen.getByLabelText("Data final"), { target: { value: "2026-03-31" } });
    await waitFor(() => expect(lastOrdersCall(calls)?.get("to")).toBe("2026-03-31"));
    expect(lastOrdersCall(calls)?.get("from")).toBe("2026-03-01");
    expect(lastOrdersCall(calls)?.get("dateField")).toBeNull();
    expect(router.state.location.search).toMatchObject({ from: "2026-03-01", to: "2026-03-31" });
    expect(screen.getByRole("button", { name: "Remover filtro: Criado de 01/03/2026 a 31/03/2026" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Data usada no período"), "updatedAt");
    await waitFor(() => expect(lastOrdersCall(calls)?.get("dateField")).toBe("updatedAt"));
    expect(screen.getByRole("button", { name: "Remover filtro: Atualizado de 01/03/2026 a 31/03/2026" })).toBeInTheDocument();
  });

  it("period: an end date before the start moves the start with it; a half-typed date sends nothing", async () => {
    const { calls } = renderApp("/pedidos?from=2026-03-10", { handlers: handlers() });
    await screen.findByText("Rascunho nº 12");
    const before = callsTo(calls, "GET", "/orders").length;
    fireEvent.change(screen.getByLabelText("Data final"), { target: { value: "2026-03-05" } });
    await waitFor(() => expect(lastOrdersCall(calls)?.get("to")).toBe("2026-03-05"));
    expect(lastOrdersCall(calls)?.get("from")).toBe("2026-03-05");
    expect(callsTo(calls, "GET", "/orders").length).toBeGreaterThan(before);
  });

  it("customer: sends only the code and shows the name in a chip that can be removed", async () => {
    const { user, calls, router } = renderApp("/pedidos", { handlers: handlers() });
    await screen.findByText("Rascunho nº 12");
    await user.click(screen.getByRole("button", { name: /Filtrar por cliente/ }));
    await user.click(await screen.findByRole("button", { name: /Beta Ltda/ }));
    await waitFor(() => expect(lastOrdersCall(calls)?.get("customerCode")).toBe("1002"));
    expect(router.state.location.search).toMatchObject({ customerCode: 1002 });
    await user.click(await screen.findByRole("button", { name: "Remover filtro: Cliente: Beta Ltda" }));
    await waitFor(() => expect(lastOrdersCall(calls)?.get("customerCode")).toBeNull());
    expect(router.state.location.search).not.toHaveProperty("customerCode");
  });

  it("single product: picked from the search list, sent as productCodes, shown as a chip with code and name", async () => {
    const { user, calls, router } = renderApp("/pedidos", { handlers: handlers() });
    await screen.findByText("Rascunho nº 12");
    await user.click(screen.getByRole("button", { name: "Filtrar por produtos" }));
    await user.click(await screen.findByRole("checkbox", { name: /Selecionar CABO FLEXIVEL/i }));
    // nothing is applied before "Aplicar filtro"
    expect(lastOrdersCall(calls)?.get("productCodes")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Aplicar filtro" }));
    await waitFor(() => expect(lastOrdersCall(calls)?.get("productCodes")).toBe("12"));
    expect(lastOrdersCall(calls)?.get("productMatch")).toBeNull();
    expect(router.state.location.search).toMatchObject({ products: [12] });
    expect(await screen.findByRole("button", { name: /Remover filtro: Produto: 12 – Cabo/i })).toBeInTheDocument();
    // one product: the "any / all" choice is not offered
    expect(screen.queryByLabelText("Combinação dos produtos")).not.toBeInTheDocument();
  });

  it("several products: 'any' by default, 'all' on request, and each chip removes only its product", async () => {
    const { user, calls, router } = renderApp("/pedidos", { handlers: handlers() });
    await screen.findByText("Rascunho nº 12");
    await user.click(screen.getByRole("button", { name: "Filtrar por produtos" }));
    await user.click(await screen.findByRole("checkbox", { name: /Selecionar CABO FLEXIVEL/i }));
    await user.click(await screen.findByRole("checkbox", { name: /Selecionar BALAO LATEX/i }));
    await user.click(screen.getByRole("button", { name: "Aplicar filtro" }));
    await waitFor(() => expect(lastOrdersCall(calls)?.get("productCodes")).toBe("12,34"));
    expect(lastOrdersCall(calls)?.get("productMatch")).toBeNull();
    expect(await screen.findByText("Contendo qualquer um:")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Combinação dos produtos"), "all");
    await waitFor(() => expect(lastOrdersCall(calls)?.get("productMatch")).toBe("all"));
    expect(lastOrdersCall(calls)?.get("productCodes")).toBe("12,34");
    expect(router.state.location.search).toMatchObject({ products: [12, 34], productMatch: "all" });
    expect(screen.getByText("Contendo todos:")).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: /Remover filtro: Produto: 34/ }));
    await waitFor(() => expect(lastOrdersCall(calls)?.get("productCodes")).toBe("12"));
    // back to one product: the match mode is dropped
    expect(lastOrdersCall(calls)?.get("productMatch")).toBeNull();
    expect(router.state.location.search).not.toHaveProperty("productMatch");
  });

  it("the product search box queries the catalog by name, code or reference", async () => {
    const { user, calls } = renderApp("/pedidos", { handlers: handlers() });
    await screen.findByText("Rascunho nº 12");
    await user.click(screen.getByRole("button", { name: "Filtrar por produtos" }));
    await user.type(await screen.findByRole("searchbox", { name: "Buscar produto para o filtro" }), "CB-25");
    await waitFor(() => expect(callsTo(calls, "GET", "/products").some((call) => call.search.get("search") === "CB-25")).toBe(true));
  });

  it("the selection survives a new search and a page change, and Cancelar discards it", async () => {
    const { user, calls } = renderApp("/pedidos", {
      handlers: handlers({ "GET /products": (request) => ({ body: request.search.get("search") === "balao" ? productsPage([BALAO]) : productsPage([CABO, BALAO], priceContext, 25) }) }),
    });
    await screen.findByText("Rascunho nº 12");
    await user.click(screen.getByRole("button", { name: "Filtrar por produtos" }));
    await user.click(await screen.findByRole("checkbox", { name: /Selecionar CABO FLEXIVEL/i }));
    await user.click(screen.getByRole("button", { name: "Próxima página" }));
    await waitFor(() => expect(callsTo(calls, "GET", "/products").some((call) => call.search.get("page") === "2")).toBe(true));
    await user.type(screen.getByRole("searchbox", { name: "Buscar produto para o filtro" }), "balao");
    await user.click(await screen.findByRole("checkbox", { name: /Selecionar BALAO LATEX/i }));
    expect(screen.getByText("2 de 20 selecionados.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(lastOrdersCall(calls)?.get("productCodes")).toBeNull();
    expect(screen.getByRole("button", { name: "Filtrar por produtos" })).toHaveTextContent("Todos os produtos");
  });

  it("the group narrows the product list; \"Limpar seleção\" then Aplicar filtro removes the product filter", async () => {
    const { user, calls } = renderApp("/pedidos?products=%5B12%5D", {
      handlers: handlers({ "GET /product-groups": { body: { items: [{ code: 7, name: "Cabos" }] } } }),
    });
    await screen.findByText("Rascunho nº 12");
    await user.click(screen.getByRole("button", { name: "Filtrar por produtos" }));
    await user.selectOptions(await screen.findByRole("combobox", { name: "Grupo dos produtos do filtro" }), "7");
    await waitFor(() => expect(callsTo(calls, "GET", "/products").some((call) => call.search.get("group") === "7")).toBe(true));
    await user.click(screen.getByRole("button", { name: "Limpar seleção" }));
    await user.click(screen.getByRole("button", { name: "Aplicar filtro" }));
    await waitFor(() => expect(lastOrdersCall(calls)?.get("productCodes")).toBeNull());
  });

  it("description of the product: typed text goes to the API as productSearch, shows a chip and can be removed", async () => {
    const { user, calls, router } = renderApp("/pedidos", { handlers: handlers() });
    await screen.findByText("Rascunho nº 12");
    await user.type(screen.getByRole("searchbox", { name: "Buscar pedidos por descrição do produto" }), "cabo flex");
    await waitFor(() => expect(lastOrdersCall(calls)?.get("productSearch")).toBe("cabo flex"));
    expect(router.state.location.search).toMatchObject({ productSearch: "cabo flex" });
    await user.click(await screen.findByRole("button", { name: "Remover filtro: Descrição do produto: cabo flex" }));
    await waitFor(() => expect(lastOrdersCall(calls)?.get("productSearch")).toBeNull());
    expect(router.state.location.search).not.toHaveProperty("productSearch");
  });

  it("combined filters: every one goes to the API together, page resets to 1 and 'Limpar filtros' clears them all", async () => {
    const { user, calls, router } = renderApp("/pedidos?page=3&pageSize=50", {
      handlers: handlers({ "GET /orders": { body: { ...ordersPage([orderListItem()], 195), page: 3, pageSize: 50 } } }),
    });
    await screen.findByText("Rascunho nº 12");
    expect(lastOrdersCall(calls)?.get("page")).toBe("3");

    await user.selectOptions(screen.getByRole("combobox", { name: /Situação/ }), "draft");
    await waitFor(() => expect(lastOrdersCall(calls)?.get("status")).toBe("draft"));
    expect(lastOrdersCall(calls)?.get("page")).toBe("1");

    fireEvent.change(screen.getByLabelText("Data inicial"), { target: { value: "2026-03-01" } });
    await waitFor(() => expect(lastOrdersCall(calls)?.get("from")).toBe("2026-03-01"));
    await user.click(screen.getByRole("button", { name: "Filtrar por produtos" }));
    await user.click(await screen.findByRole("checkbox", { name: /Selecionar CABO FLEXIVEL/i }));
    await user.click(screen.getByRole("button", { name: "Aplicar filtro" }));
    await waitFor(() => expect(lastOrdersCall(calls)?.get("productCodes")).toBe("12"));
    await user.click(screen.getByRole("button", { name: /Filtrar por cliente/ }));
    await user.click(await screen.findByRole("button", { name: /Beta Ltda/ }));

    await waitFor(() => {
      const search = lastOrdersCall(calls);
      expect(search?.get("status")).toBe("draft");
      expect(search?.get("from")).toBe("2026-03-01");
      expect(search?.get("productCodes")).toBe("12");
      expect(search?.get("customerCode")).toBe("1002");
      expect(search?.get("pageSize")).toBe("50");
    });

    await user.click(screen.getAllByRole("button", { name: "Limpar filtros" })[0]!);
    await waitFor(() => {
      const search = lastOrdersCall(calls);
      expect(search?.get("status")).toBeNull();
      expect(search?.get("from")).toBeNull();
      expect(search?.get("productCodes")).toBeNull();
      expect(search?.get("customerCode")).toBeNull();
    });
    // the page size the user chose survives the clearing
    expect(router.state.location.search).toEqual({ pageSize: 50 });
    expect(screen.queryByLabelText("Filtros ativos")).not.toBeInTheDocument();
  });

  it("URL persistence: a link with every filter reproduces the same query, chips and controls", async () => {
    const { calls } = renderApp(
      `/pedidos?${new URLSearchParams({ search: "12", status: "draft", customerCode: "1002", from: "2026-03-01", to: "2026-03-31", dateField: "updatedAt", products: "[12,34]", productMatch: "all", productSearch: "cabo" })}`,
      { handlers: handlers() },
    );
    await screen.findByText("Rascunho nº 12");
    const search = callsTo(calls, "GET", "/orders")[0]!.search;
    expect(search.get("search")).toBe("12");
    expect(search.get("status")).toBe("draft");
    expect(search.get("customerCode")).toBe("1002");
    expect(search.get("from")).toBe("2026-03-01");
    expect(search.get("to")).toBe("2026-03-31");
    expect(search.get("dateField")).toBe("updatedAt");
    expect(search.get("productCodes")).toBe("12,34");
    expect(search.get("productMatch")).toBe("all");
    expect(search.get("productSearch")).toBe("cabo");

    expect(screen.getByLabelText("Data inicial")).toHaveValue("2026-03-01");
    expect(screen.getByLabelText("Data final")).toHaveValue("2026-03-31");
    expect(screen.getByLabelText("Data usada no período")).toHaveValue("updatedAt");
    expect(screen.getByLabelText("Combinação dos produtos")).toHaveValue("all");
    expect(screen.getByRole("button", { name: "Filtrar por produtos" })).toHaveTextContent("2 produtos selecionados");
    expect(await screen.findByRole("button", { name: "Remover filtro: Cliente: Beta Ltda" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Remover filtro: Produto: 12 – Cabo/i })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Remover filtro: Produto: 34 – Balao/i })).toBeInTheDocument();
    expect(screen.getByText("Contendo todos:")).toBeInTheDocument();
  });

  it("pagination keeps every filter and changes only the page", async () => {
    const { user, calls, router } = renderApp("/pedidos?status=draft&from=2026-03-01&products=%5B12%5D", {
      handlers: handlers({ "GET /orders": { body: ordersPage([orderListItem()], 60) } }),
    });
    await screen.findByText("Rascunho nº 12");
    await user.click(screen.getByRole("button", { name: "Próxima página" }));
    await waitFor(() => expect(lastOrdersCall(calls)?.get("page")).toBe("2"));
    const search = lastOrdersCall(calls);
    expect(search?.get("status")).toBe("draft");
    expect(search?.get("from")).toBe("2026-03-01");
    expect(search?.get("productCodes")).toBe("12");
    expect(router.state.location.search).toMatchObject({ page: 2, status: "draft", from: "2026-03-01", products: [12] });
  });

  it("empty result with filters: says nothing was found and offers to clear them", async () => {
    const { user, calls } = renderApp("/pedidos?from=2026-03-01&products=%5B12%5D", { handlers: handlers({ "GET /orders": { body: ordersPage([]) } }) });
    expect(await screen.findByText("Nenhum pedido encontrado")).toBeInTheDocument();
    expect(screen.queryByText("Nenhum pedido ainda")).not.toBeInTheDocument();
    const empty = screen.getByText("Nenhum pedido encontrado").closest("td")!;
    await user.click(within(empty).getByRole("button", { name: "Limpar filtros" }));
    await waitFor(() => expect(lastOrdersCall(calls)?.get("productCodes")).toBeNull());
    expect(lastOrdersCall(calls)?.get("from")).toBeNull();
  });

  it("shows a glance of the items in each order", async () => {
    renderApp("/pedidos", {
      handlers: handlers({ "GET /orders": { body: ordersPage([orderListItem({ itemCount: 5, itemPreview: ["Cabo flexível", "Balão látex", "Fita isolante"] })]) } }),
    });
    expect(await screen.findByText("Cabo flexível · Balão látex · Fita isolante · +2")).toBeInTheDocument();
  });

  it("an invalid or contradictory link degrades to the filters that make sense", async () => {
    const { calls } = renderApp("/pedidos?from=2026-13-40&to=2026-03-01&products=%5B%22x%22%5D&productMatch=some&dateField=deletedAt", { handlers: handlers() });
    await screen.findByText("Rascunho nº 12");
    const search = callsTo(calls, "GET", "/orders")[0]!.search;
    // the valid end date stays (no start to contradict it); everything invalid is dropped
    expect(search.get("to")).toBe("2026-03-01");
    for (const key of ["from", "productCodes", "productMatch", "dateField"]) expect(search.get(key), key).toBeNull();
  });
});

describe("parsing of the Vendas URL", () => {
  it("asDate accepts only real calendar dates", () => {
    expect(asDate("2026-02-28")).toBe("2026-02-28");
    for (const bad of ["2026-02-30", "2026-13-01", "28/02/2026", "", "2026-2-1", 20260228, undefined, "1800-01-01", "2200-01-01"]) expect(asDate(bad), String(bad)).toBeUndefined();
  });

  it("asIntList accepts an array, a number or a comma list, deduplicates and caps", () => {
    expect(asIntList([12, 34, 12], 5)).toEqual([12, 34]);
    expect(asIntList("12,34", 5)).toEqual([12, 34]);
    expect(asIntList(7, 5)).toEqual([7]);
    expect(asIntList(["12", "x"], 5)).toEqual([12]);
    expect(asIntList(["x"], 5)).toBeUndefined();
    expect(asIntList([], 5)).toBeUndefined();
    expect(asIntList([1, 2, 3, 4, 5, 6], 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("parseOrdersSearch drops what would be inconsistent", () => {
    expect(parseOrdersSearch({ from: "2026-03-10", to: "2026-03-01" })).toEqual({ from: "2026-03-10" });
    expect(parseOrdersSearch({ dateField: "updatedAt" })).toEqual({});
    expect(parseOrdersSearch({ from: "2026-03-01", dateField: "createdAt" })).toEqual({ from: "2026-03-01" });
    expect(parseOrdersSearch({ from: "2026-03-01", dateField: "updatedAt" })).toEqual({ from: "2026-03-01", dateField: "updatedAt" });
    expect(parseOrdersSearch({ products: [12], productMatch: "all" })).toEqual({ products: [12] });
    expect(parseOrdersSearch({ products: [12, 34], productMatch: "all" })).toEqual({ products: [12, 34], productMatch: "all" });
    expect(parseOrdersSearch({ products: [12, 34], productMatch: "any" })).toEqual({ products: [12, 34] });
    expect(parseOrdersSearch({ products: Array.from({ length: MAX_ORDER_PRODUCTS + 3 }, (_, i) => i + 1) }).products).toHaveLength(MAX_ORDER_PRODUCTS);
  });
});
