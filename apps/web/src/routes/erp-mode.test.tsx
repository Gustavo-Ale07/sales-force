import type { ApiSchema } from "@salesforce/contracts/client";
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { customerDetail, orderDetail, orderEntryConfiguration, ORDER_ID } from "../test/fixtures";
import { callsTo, renderApp, type Handlers } from "../test/harness";
import { ERP_RELEASE_NOTE } from "./order-editor";

/** D-M: with `sales.discountAuthorityMode = 'erp'` Sankhya releases discounts; every Sales Force approval surface is hidden. */
const erpConfig = (): ApiSchema<"OrderEntryConfiguration"> => ({
  ...orderEntryConfiguration,
  sales: { ...orderEntryConfiguration.sales, discountAuthorityMode: "erp" },
});
const erpHandlers: Handlers = { "GET /order-entry/configuration": { body: erpConfig() } };
const forceHandlers: Handlers = { "GET /order-entry/configuration": { body: orderEntryConfiguration } };

describe("modo erp (D-M)", () => {
  it("hides Aprovações and Limites de desconto from the navigation for the admin", async () => {
    renderApp("/", { handlers: erpHandlers, role: "admin" });
    await screen.findAllByRole("link", { name: "Vendas" });
    await waitFor(() => expect(screen.queryByRole("link", { name: "Aprovações" })).not.toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "Limites de desconto" })).not.toBeInTheDocument();
  });

  it("keeps both entries in force mode", async () => {
    renderApp("/", { handlers: forceHandlers, role: "admin" });
    expect((await screen.findAllByRole("link", { name: "Aprovações" })).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Limites de desconto" }).length).toBeGreaterThan(0);
  });

  it("replaces the approvals and limits routes by an explanation, without loading their data", async () => {
    for (const path of ["/aprovacoes", "/limites-desconto"]) {
      const { calls, unmount } = renderApp(path, { handlers: erpHandlers, role: "admin" });
      expect(await screen.findByText("Liberação feita no Sankhya")).toBeInTheDocument();
      expect(callsTo(calls, "GET", "/approvals")).toHaveLength(0);
      expect(callsTo(calls, "GET", "/discount-limits")).toHaveLength(0);
      unmount();
    }
  });

  it("shows the Sankhya release note in the order footer, only in erp mode", async () => {
    const handlers = { "GET /customers/:code": { body: customerDetail() } };
    const erp = renderApp("/pedidos/novo?customer=1001", { handlers: { ...handlers, ...erpHandlers } });
    expect(await screen.findByText(ERP_RELEASE_NOTE)).toBeInTheDocument();
    expect(ERP_RELEASE_NOTE).toBe("Descontos acima do permitido passam pela liberação no Sankhya depois do envio.");
    erp.unmount();
    renderApp("/pedidos/novo?customer=1001", { handlers: { ...handlers, ...forceHandlers } });
    await screen.findByRole("heading", { name: /^Novo pedido/ });
    await screen.findByText(/condição de pagamento e a análise de crédito/);
    expect(screen.queryByText(ERP_RELEASE_NOTE)).not.toBeInTheDocument();
  });

  it("does not show the approval alert of an order in erp mode", async () => {
    const approval = { requestedLevel: "manager", requestedAt: "2026-09-20T12:00:00.000Z", decision: "pending", decidedAt: null, decidedByName: null, comment: null } as const;
    const order = orderDetail({ status: "awaiting_approval", approval });
    const handlers = (extra: Handlers): Handlers => ({ [`GET /orders/${ORDER_ID}`]: { body: order }, ...extra });
    const erp = renderApp(`/pedidos/${ORDER_ID}`, { handlers: handlers(erpHandlers) });
    await screen.findByText(ERP_RELEASE_NOTE);
    expect(screen.queryByText("Aguardando aprovação de desconto")).not.toBeInTheDocument();
    erp.unmount();
    renderApp(`/pedidos/${ORDER_ID}`, { handlers: handlers(forceHandlers) });
    expect(await screen.findByText("Aguardando aprovação de desconto")).toBeInTheDocument();
  });
});
