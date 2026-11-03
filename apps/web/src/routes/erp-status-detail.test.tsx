import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { erpStatusText } from "../lib/labels";
import { ORDER_ID, customer, customerDetail, customersPage, orderDetail, orderListItem, ordersPage, orderEntryConfiguration, pricedList, product, productsPage } from "../test/fixtures";
import { renderApp, type Handlers } from "../test/harness";

const sent = { code: 1, label: "Pendente", invoiceNumber: null, checkedAt: "2026-11-03T12:00:00.000Z" };

describe("erpStatusText (D6b)", () => {
  it("has no detail without release events", () => {
    expect(erpStatusText(sent)).toEqual({ label: "Pendente", detail: null });
  });
  it("names the events by the configured label and falls back to 'evento N'", () => {
    const status = { ...sent, releaseEvents: [{ code: 44, label: "liberação exigida pela TOP" }, { code: 2, label: null }] };
    expect(erpStatusText(status).detail).toBe("pendente: liberação exigida pela TOP, evento 2");
  });
});

const editorHandlers = (erpStatus: typeof sent & { releaseEvents?: { code: number; label: string | null }[] }): Handlers => ({
  "GET /order-entry/configuration": { body: orderEntryConfiguration },
  "GET /customers/:code": { body: customerDetail() },
  "GET /customers": { body: customersPage([customer()]) },
  "GET /products": { body: productsPage([product({ code: 2001, listPrice: pricedList("12.5") })]) },
  "GET /orders/:id": { body: orderDetail({ erpStatus }) },
});

describe("Sankhya status on the order screens (E2)", () => {
  it("list: shows the Sankhya label beside the Force status", async () => {
    renderApp("/pedidos", { handlers: { "GET /orders": { body: ordersPage([orderListItem({ erpStatus: sent })]) } } });
    expect(await screen.findByText("Sankhya: Pendente")).toBeInTheDocument();
  });
  it("detail: shows the pending release event named by the configuration", async () => {
    const status = { ...sent, releaseEvents: [{ code: 44, label: "liberação exigida pela TOP" }] };
    renderApp(`/pedidos/${ORDER_ID}`, { handlers: editorHandlers(status) });
    expect(await screen.findByText("Sankhya: Pendente")).toBeInTheDocument();
    expect(screen.getByText("pendente: liberação exigida pela TOP")).toBeInTheDocument();
  });
  it("detail: without a configured name the event reads 'evento N'", async () => {
    renderApp(`/pedidos/${ORDER_ID}`, { handlers: editorHandlers({ ...sent, releaseEvents: [{ code: 13, label: null }] }) });
    expect(await screen.findByText("pendente: evento 13")).toBeInTheDocument();
  });
});
