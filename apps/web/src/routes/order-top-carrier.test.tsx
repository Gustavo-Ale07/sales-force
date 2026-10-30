import type { ApiSchema } from "@salesforce/contracts/client";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ORDER_ID, customer, customerDetail, customersPage, orderDetail, orderEntryConfiguration, orderItem, pricedList, product, productsPage } from "../test/fixtures";
import { apiError, callsTo, renderApp, type Handlers } from "../test/harness";

const NEW_ID = "0190a000-0000-7000-8000-0000000000bb";
const config: ApiSchema<"OrderEntryConfiguration"> = {
  ...orderEntryConfiguration,
  sales: {
    ...orderEntryConfiguration.sales,
    discountAuthorityMode: "erp",
    negotiationTypes: [
      { code: 2, label: "30 dias" },
      { code: 23, label: "Devolução", sellable: false },
      { code: 24, label: "Troca", sellable: false },
    ],
    defaultNegotiationTypeCode: 2,
    orderTops: { defaultTopCode: 1001, quotationTopCode: 1000, eligibleTopCodes: [1001, 1000] },
  },
};
const carriers = { items: [{ code: 7, name: "Transportes Alfa" }, { code: 9, name: "Beta Cargas" }] };
const base = (extra: Handlers = {}): Handlers => ({
  "GET /order-entry/configuration": { body: config },
  "GET /carriers": { body: carriers },
  "GET /customers/:code": { body: customerDetail() },
  "GET /customers": { body: customersPage([customer()]) },
  "GET /products": { body: productsPage([product({ code: 2001, description: "Balão látex", listPrice: pricedList("12.5") })]) },
  ...extra,
});

describe("TOP do pedido e transportadora (D-A, D-C)", () => {
  it("offers only the eligible TOPs with the default selected, and sellable negotiation types", async () => {
    renderApp("/pedidos/novo?customer=1001", { handlers: base() });
    const top = await screen.findByLabelText("Tipo de operação (TOP)");
    await waitFor(() => expect(top).toHaveValue("1001"));
    expect(within(top).getAllByRole("option").map((o) => o.textContent)).toEqual(["Pedido (TOP 1001)", "Orçamento (TOP 1000)"]);
    const negotiation = screen.getByLabelText("Tipo de negociação");
    expect(within(negotiation).queryByRole("option", { name: "Devolução" })).not.toBeInTheDocument();
    expect(within(negotiation).queryByRole("option", { name: "Troca" })).not.toBeInTheDocument();
    expect(within(negotiation).getByRole("option", { name: "30 dias" })).toBeInTheDocument();
  });

  it("sends topCode and carrierCode (none by default, null) when creating", async () => {
    const { user, calls } = renderApp("/pedidos/novo?customer=1001", {
      handlers: base({ "POST /orders": { status: 201, body: orderDetail({ id: NEW_ID }) } }),
    });
    const carrier = await screen.findByLabelText("Transportadora");
    await waitFor(() => expect(within(carrier).getAllByRole("option")).toHaveLength(3));
    expect(carrier).toHaveValue("");
    await user.selectOptions(screen.getByLabelText("Tipo de operação (TOP)"), "1000");
    await user.selectOptions(carrier, "9");
    await user.click(await screen.findByRole("button", { name: "Produtos" }));
    await user.click(await screen.findByRole("button", { name: /^Adicionar .*Balão/ }));
    await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(callsTo(calls, "POST", "/orders")).toHaveLength(1));
    expect(callsTo(calls, "POST", "/orders")[0]?.body).toMatchObject({ topCode: 1000, carrierCode: 9 });
  });

  it("explains an unknown carrier issue from the server", async () => {
    const { user } = renderApp("/pedidos/novo?customer=1001", {
      handlers: base({
        "POST /orders": apiError(400, "validation_failed", "Inválido", { issues: [{ path: "carrierCode", code: "carrier_unknown", message: "x" }] }),
      }),
    });
    await user.selectOptions(await screen.findByLabelText("Transportadora"), "7").catch(() => undefined);
    await user.click(await screen.findByRole("button", { name: "Produtos" }));
    await user.click(await screen.findByRole("button", { name: /^Adicionar .*Balão/ }));
    await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect(await screen.findByText("Transportadora inválida ou inativa.")).toBeInTheDocument();
  });
});

describe("Duplicar como pedido (D-B)", () => {
  const quotation = (extra: Partial<ApiSchema<"OrderDetail">> = {}) =>
    orderDetail({ topCode: 1000, items: [orderItem()], ...extra });
  const open = (extra: Handlers) =>
    renderApp(`/pedidos/${ORDER_ID}`, { handlers: base({ [`GET /orders/${ORDER_ID}`]: { body: quotation() }, "GET /orders/:id": { body: quotation() }, ...extra }) });

  it("is offered only for a quotation (replacing the plain duplicate)", async () => {
    open({});
    expect(await screen.findByRole("button", { name: "Duplicar como pedido" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Duplicar pedido" })).not.toBeInTheDocument();
  });

  it("is not offered for an ordinary order", async () => {
    renderApp(`/pedidos/${ORDER_ID}`, { handlers: base({ "GET /orders/:id": { body: orderDetail({ topCode: 1001 }) } }) });
    expect(await screen.findByRole("button", { name: "Duplicar pedido" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Duplicar como pedido" })).not.toBeInTheDocument();
  });

  it("posts clientRequestId and expectedDataset, opens the new draft and lists the skipped lines", async () => {
    const { user, calls, router } = open({
      "POST /orders/:id/duplicate-as-order": {
        status: 201,
        body: { order: orderDetail({ id: NEW_ID, topCode: 1001 }), skippedLines: [{ lineNo: 2, productCode: 3003, reason: "no_price" }] },
      },
      "GET /orders/:id": { body: orderDetail({ id: NEW_ID, topCode: 1001 }) },
    });
    await user.click(await screen.findByRole("button", { name: "Duplicar como pedido" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/pedidos/${NEW_ID}`));
    const body = callsTo(calls, "POST", `/orders/${ORDER_ID}/duplicate-as-order`)[0]?.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["clientRequestId", "expectedDataset"]);
    expect(await screen.findByText(/Código 3003: Produto sem preço para este cliente/)).toBeInTheDocument();
  });

  it.each([
    ["not_a_quotation", "Este pedido não é um orçamento"],
    ["source_cancelled", "Orçamento descartado"],
    ["order_top_not_configured", "Tipo de operação do pedido não configurado"],
    ["no_usable_lines", "Nenhum item do orçamento pode ser pedido agora"],
  ])("explains the 409 %s", async (reason, title) => {
    const { user } = open({
      "POST /orders/:id/duplicate-as-order": apiError(409, "conflict", "x", {
        details: { reason, ...(reason === "no_usable_lines" ? { skippedLines: [{ lineNo: 1, productCode: 2001, reason: "product_inactive" }] } : {}) },
      }),
    });
    await user.click(await screen.findByRole("button", { name: "Duplicar como pedido" }));
    expect(await screen.findByText(title)).toBeInTheDocument();
    if (reason === "no_usable_lines") expect(await screen.findByText(/Produto inativo/)).toBeInTheDocument();
  });
});
