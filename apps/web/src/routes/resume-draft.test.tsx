import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { customer, customersPage, orderListItem, ordersPage } from "../test/fixtures";
import { callsTo, renderApp } from "../test/harness";

const base = { "GET /customers": { body: customersPage([customer()]) } };

describe("Novo pedido: Continuar o pedido em andamento?", () => {
  it("asks when a draft saved on the server exists; Continuar opens it", async () => {
    const draft = orderListItem({ id: "0190a000-0000-7000-8000-0000000000d1", status: "draft", customerName: "COMERCIAL ALFA LTDA" });
    const { user, router, calls } = renderApp("/pedidos/novo", { handlers: { ...base, "GET /orders": { body: ordersPage([draft]) } } });
    expect(await screen.findByText("Continuar o pedido em andamento?")).toBeInTheDocument();
    expect(callsTo(calls, "GET", "/orders").at(0)?.search.get("status")).toBe("draft");
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/pedidos/${draft.id}`));
  });

  it("Novo pedido dismisses the question and stays on the empty editor", async () => {
    const draft = orderListItem({ status: "draft" });
    const { user, router } = renderApp("/pedidos/novo", { handlers: { ...base, "GET /orders": { body: ordersPage([draft]) } } });
    await user.click(await screen.findByRole("button", { name: "Novo pedido" }));
    await waitFor(() => expect(screen.queryByText("Continuar o pedido em andamento?")).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe("/pedidos/novo");
  });

  it("does not ask without a saved draft, nor when a customer is chosen from the link", async () => {
    renderApp("/pedidos/novo", { handlers: { ...base, "GET /orders": { body: ordersPage([]) } } });
    await screen.findByRole("heading", { name: /^Novo pedido/ });
    expect(screen.queryByText("Continuar o pedido em andamento?")).not.toBeInTheDocument();
    const withCustomer = renderApp("/pedidos/novo?customer=1001", { handlers: { ...base, "GET /orders": { body: ordersPage([orderListItem({ status: "draft" })]) } } });
    await screen.findAllByRole("heading", { name: /^Novo pedido/ });
    expect(callsTo(withCustomer.calls, "GET", "/orders")).toHaveLength(0);
  });
});
