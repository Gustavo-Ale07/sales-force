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
});
