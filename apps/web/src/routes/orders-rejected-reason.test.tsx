import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { deliveryErrorText } from "../lib/labels";
import { customer, customersPage, orderListItem, ordersPage } from "../test/fixtures";
import { renderApp, type Handlers } from "../test/harness";

const handlers = (items: ReturnType<typeof orderListItem>[]): Handlers => ({
  "GET /orders": { body: ordersPage(items) },
  "GET /customers": { body: customersPage([customer()]) },
});

describe("K3: motivo da falha de envio", () => {
  it("a rejected order shows the human reason for environment_mismatch in the list", async () => {
    renderApp("/pedidos", {
      handlers: handlers([orderListItem({ status: "rejected", erpDelivery: { errorClass: "validation", errorCode: "environment_mismatch" } })]),
    });
    expect(await screen.findByText("Configuração de ambiente divergente — avise o TI")).toBeInTheDocument();
  });

  it("an order that is not rejected shows no reason", async () => {
    renderApp("/pedidos", { handlers: handlers([orderListItem({ status: "draft" })]) });
    await screen.findByText("Pedido nº 12");
    expect(screen.queryByText(/avise o TI/)).not.toBeInTheDocument();
  });

  it("maps codes, falls back by class, and never invents text", () => {
    expect(deliveryErrorText({ errorClass: "validation", errorCode: "send_disabled" })).toBe("Envio ao Sankhya desligado");
    expect(deliveryErrorText({ errorClass: "validation", errorCode: "something_new" })).toBe("O Sankhya ou o Sales Force recusou os dados do pedido");
    expect(deliveryErrorText({ errorClass: "exhausted", errorCode: null })).toBe("Falha no envio (exhausted)");
    expect(deliveryErrorText(null)).toBeNull();
    expect(deliveryErrorText(undefined)).toBeNull();
  });
});
