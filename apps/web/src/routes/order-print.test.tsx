import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORDER_ID, orderDetail, orderItem, orderListItem, ordersPage } from "../test/fixtures";
import { apiError, callsTo, renderApp } from "../test/harness";

const printed: string[] = [];
vi.mock("../lib/print-html", () => ({ printHtml: (html: string) => void printed.push(html) }));

beforeEach(() => {
  printed.length = 0;
});

describe("Imprimir / PDF", () => {
  it("list: reads the order, prints the PLAC template without touching the row", async () => {
    const detail = orderDetail({ erpNumber: 777, status: "sent", notes: "Entregar cedo" });
    const { calls, user, router } = renderApp("/pedidos", {
      handlers: { "GET /orders": { body: ordersPage([orderListItem()]) }, "GET /orders/:id": { body: detail } },
    });
    await user.click(await screen.findByRole("button", { name: /^Imprimir \/ PDF / }, { timeout: 8000 }));
    await waitFor(() => expect(printed).toHaveLength(1));
    expect(callsTo(calls, "GET", "/orders/:id".replace(":id", ORDER_ID))).toHaveLength(1);
    expect(router.state.location.pathname).toBe("/pedidos");
    expect(printed[0]).toContain("#01136A");
    expect(printed[0]).toContain("Pedido Sankhya nº 777");
    expect(printed[0]).toContain("Enviado ao Sankhya");
    expect(printed[0]).toContain("Entregar cedo");
    expect(printed[0]).not.toContain("ERP");
  });

  it("detail: prints the loaded order and never carries cost or margin even if the payload has them", async () => {
    const detail = {
      ...orderDetail({ items: [orderItem({ quantity: "2.5" })] }),
      cost: "321.99",
      margin: "44.4",
    };
    const { user } = renderApp(`/pedidos/${ORDER_ID}`, { handlers: { "GET /orders/:id": { body: detail } } });
    await user.click(await screen.findByRole("button", { name: /Imprimir \/ PDF/ }, { timeout: 8000 }));
    await waitFor(() => expect(printed).toHaveLength(1));
    expect(printed[0]).toContain("2,5");
    expect(printed[0]).not.toContain("321");
    expect(printed[0]).not.toContain("44,4");
  });

  it("list: a failed read shows an actionable error and prints nothing", async () => {
    const { user } = renderApp("/pedidos", {
      handlers: {
        "GET /orders": { body: ordersPage([orderListItem()]) },
        "GET /orders/:id": apiError(403, "forbidden", "Sem acesso"),
      },
    });
    await user.click(await screen.findByRole("button", { name: /^Imprimir \/ PDF / }, { timeout: 8000 }));
    expect(await screen.findByText("Sem permissão")).toBeInTheDocument();
    expect(printed).toHaveLength(0);
  });
});
