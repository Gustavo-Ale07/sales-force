import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { erpBillingItemText, erpBillingLabels, erpBillingText, erpReleaseEventText, erpReleaseLabels, erpStatusText } from "../lib/labels";
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

describe("release (liberação) labels", () => {
  it("awaiting is amber, released green, denied red", () => {
    expect(erpReleaseLabels.awaiting).toEqual({ label: "Aguardando liberação", tone: "warning" });
    expect(erpReleaseLabels.released).toEqual({ label: "Liberado", tone: "success" });
    expect(erpReleaseLabels.denied).toEqual({ label: "Negado", tone: "danger" });
  });
  it("names an event by its description, else 'evento N'", () => {
    expect(erpReleaseEventText({ code: 3, label: "Limite de crédito", state: "released" })).toBe("Limite de crédito: liberado");
    expect(erpReleaseEventText({ code: 13, label: null, state: "denied" })).toBe("evento 13: negado");
  });
});

describe("billing (faturamento) labels", () => {
  it("uses the owner colours and never relies on colour alone (every state has a label)", () => {
    expect(erpBillingLabels.invoiced).toMatchObject({ label: "Faturado", tone: "success" });
    expect(erpBillingLabels.awaiting_billing).toMatchObject({ label: "Aguardando faturamento", tone: "info" });
    expect(erpBillingLabels.cancelled).toMatchObject({ label: "Cancelado", tone: "neutral" });
    expect(erpBillingLabels.denied).toMatchObject({ label: "Negado", tone: "danger" });
    expect(erpBillingLabels.awaiting_release).toMatchObject({ label: "Aguardando liberação", tone: "warning" });
    expect(erpBillingLabels.sent.label).toBe("Enviado (sem confirmação)");
  });
  it("says the invoicing date and the NF-e only when present; cut quantities show beside the invoiced ones", () => {
    expect(erpBillingText({ state: "invoiced", invoicedAt: "2026-11-09", nfeAuthorized: true })).toBe("Faturado em 09/11/2026 · NF-e autorizada.");
    expect(erpBillingText({ state: "invoiced" })).toBe("Faturado.");
    expect(erpBillingText({ state: "invoiced", invoicedAt: "2026-11-09", nfeAuthorized: false })).toBe("Faturado em 09/11/2026.");
    expect(erpBillingText({ state: "awaiting_billing" })).toBe("Liberado e confirmado; aguardando o faturamento.");
    expect(erpBillingItemText({ sequence: 1, productCode: 4158, invoicedQuantity: "4", cutQuantity: "6" })).toBe("faturado 4 · cortado 6");
    expect(erpBillingItemText({ sequence: 1, productCode: 4158, invoicedQuantity: "10", cutQuantity: "0" })).toBe("faturado 10");
  });
});

describe("release (liberação) on the order screens", () => {
  const checkedAt = "2026-11-10T12:00:00.000Z";
  it.each([
    ["awaiting", "Aguardando liberação"],
    ["released", "Liberado"],
    ["denied", "Negado"],
  ] as const)("list: shows %s", async (state, label) => {
    renderApp("/pedidos", { handlers: { "GET /orders": { body: ordersPage([orderListItem({ erpRelease: { state, checkedAt } })]) } } });
    expect(await screen.findByText(label)).toBeInTheDocument();
  });
  it("detail: awaiting reads as a calm sentence with the reason of each event", async () => {
    const erpRelease = {
      state: "awaiting" as const,
      checkedAt,
      events: [
        { code: 44, label: "Liberação exigida pela TOP", state: "awaiting" as const },
        { code: 3, label: "Limite de crédito", state: "released" as const },
      ],
    };
    renderApp(`/pedidos/${ORDER_ID}`, {
      handlers: {
        "GET /order-entry/configuration": { body: orderEntryConfiguration },
        "GET /customers/:code": { body: customerDetail() },
        "GET /customers": { body: customersPage([customer()]) },
        "GET /products": { body: productsPage([product({ code: 2001, listPrice: pricedList("12.5") })]) },
        "GET /orders/:id": { body: orderDetail({ erpRelease }) },
      },
    });
    expect(await screen.findByText("Aguardando a liberação no Sankhya.")).toBeInTheDocument();
    expect(screen.getByText("Liberação exigida pela TOP: aguardando liberação")).toBeInTheDocument();
    expect(screen.getByText("Limite de crédito: liberado")).toBeInTheDocument();
  });
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
