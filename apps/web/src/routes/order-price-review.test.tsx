import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ORDER_ID, orderDetail } from "../test/fixtures";
import { callsTo, renderApp } from "../test/harness";

/** P-09: changed table prices are decided line by line; the server validates and prices again. */

const review = {
  orderId: ORDER_ID,
  version: 3,
  lines: [
    { lineNo: 1, productCode: 10, productDescription: "Parafuso", unit: "UN", quantity: "2", previousUnitPrice: "1.5", currentUnitPrice: "1.8" },
    { lineNo: 2, productCode: 11, productDescription: "Porca", unit: "UN", quantity: "4", previousUnitPrice: "0.5", currentUnitPrice: null },
  ],
};

describe("Pedido: revisão de preço item a item", () => {
  it("lists the changed lines and only confirms after every line has a decision", async () => {
    const { user, calls } = renderApp(`/pedidos/${ORDER_ID}`, {
      handlers: {
        "GET /orders/:id": { body: orderDetail() },
        "GET /orders/:id/price-review": { body: review },
        "POST /orders/:id/price-review": { body: orderDetail() },
      },
    });
    expect(await screen.findByRole("button", { name: "Aceitar preço de Parafuso" }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getAllByText("Sem preço").length).toBeGreaterThan(0);
    const confirm = screen.getByRole("button", { name: "Confirmar" });
    expect(confirm).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Aceitar preço de Parafuso" }));
    expect(confirm).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Recusar preço de Porca" }));
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(callsTo(calls, "POST", `/orders/${ORDER_ID}/price-review`)).toHaveLength(1));
    const [request] = callsTo(calls, "POST", `/orders/${ORDER_ID}/price-review`);
    expect(request?.body).toMatchObject({
      expectedVersion: 3,
      decisions: [
        { lineNo: 1, decision: "accept" },
        { lineNo: 2, decision: "refuse" },
      ],
    });
  });

  it("a line without a current price cannot be accepted", async () => {
    renderApp(`/pedidos/${ORDER_ID}`, {
      handlers: { "GET /orders/:id": { body: orderDetail() }, "GET /orders/:id/price-review": { body: review } },
    });
    expect(await screen.findByRole("button", { name: "Aceitar preço de Porca" })).toBeDisabled();
  });
});
