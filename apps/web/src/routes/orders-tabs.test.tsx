import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { orderListItem, ordersPage } from "../test/fixtures";
import { callsTo, renderApp } from "../test/harness";

const handlers = { "GET /orders": { body: ordersPage([orderListItem()]) } };

describe("Vendas: abas Não enviados / Enviados", () => {
  it("opens on Não enviados (group=unsent, Situação) and Enviados switches to the Sankhya stage filter", async () => {
    const { user, calls, router } = renderApp("/pedidos", { handlers });
    await screen.findAllByText("Comercial Alfa Ltda");
    expect(callsTo(calls, "GET", "/orders").at(-1)?.search.get("group")).toBe("unsent");
    expect(screen.getByRole("combobox", { name: "Situação" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Situação no Sankhya" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Enviados" }));
    await waitFor(() => expect(callsTo(calls, "GET", "/orders").at(-1)?.search.get("group")).toBe("sent"));
    expect(router.state.location.search).toMatchObject({ group: "sent" });
    expect(screen.getByRole("combobox", { name: "Situação no Sankhya" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Situação" })).not.toBeInTheDocument();
  });

  it("a link with a Sankhya stage lands on Enviados", async () => {
    const { calls } = renderApp("/pedidos?stage=invoiced", { handlers });
    await screen.findAllByText("Comercial Alfa Ltda");
    expect(callsTo(calls, "GET", "/orders").at(-1)?.search.get("group")).toBe("sent");
  });

  it("the list shows ONE situation label per order, with no second line of Sankhya jargon", async () => {
    const order = orderListItem({ status: "sent", erpStatus: { code: 0, label: "Pendente", invoiceNumber: null, checkedAt: "2026-11-10T12:00:00.000Z" }, erpBilling: { state: "sent" } });
    renderApp("/pedidos?group=sent", { handlers: { "GET /orders": { body: ordersPage([order]) } } });
    await screen.findAllByText("Comercial Alfa Ltda");
    expect(screen.queryByText("Enviado (sem confirmação)")).not.toBeInTheDocument();
    expect(screen.queryByText(/Sankhya: Pendente/)).not.toBeInTheDocument();
  });
});
