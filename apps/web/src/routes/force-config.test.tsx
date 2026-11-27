import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { customersPage, customerDetail, dashboard, ordersPage } from "../test/fixtures";
import { callsTo, renderApp } from "../test/harness";
import { parseMaxDays } from "./force-settings";

const shellData = {
  "GET /dashboard": { body: dashboard() },
  "GET /customers": { body: customersPage([]) },
  "GET /customers/:code": { body: customerDetail() },
  "GET /orders": { body: ordersPage([]) },
};
const settings = { maxDaysWithoutSync: 7, defaultPriceTableCode: 5, updatedAt: "2026-11-27T10:00:00.000Z" };
const tables = { items: [{ code: 5, name: "Tabela Padrão" }, { code: 8, name: "Atacado" }], defaultCode: 5 };
const sellers = { items: [{ code: 3, name: "Ana Souza", active: true }, { code: 4, name: "Bruno Lima", active: true }] };
const rule = { id: "0198a000-0000-7000-8000-000000000001", sellerCode: 3, sellerName: "Ana Souza", targetKind: "product", targetCode: 7, targetName: "Copo", maxPercent: "12.5000", updatedAt: "2026-11-27T10:00:00.000Z" };

describe("parseMaxDays", () => {
  it("accepts 1 to 60 only", () => {
    expect(parseMaxDays("7")).toBe(7);
    expect(parseMaxDays("60")).toBe(60);
    for (const bad of ["0", "61", "", "x", "1.5"]) expect(parseMaxDays(bad)).toBeNull();
  });
});

describe("Parâmetros", () => {
  it("shows access denied to a seller, without asking for the parameters", async () => {
    const { calls } = renderApp("/parametros", { handlers: shellData, role: "seller" });
    expect(await screen.findByText("Acesso negado")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(callsTo(calls, "GET", "/force-config")).toHaveLength(0);
    expect(callsTo(calls, "GET", "/goals")).toHaveLength(0);
  });

  it("loads, validates and saves both fields", async () => {
    const { user, calls } = renderApp("/parametros?aba=geral", {
      handlers: {
        ...shellData,
        "GET /force-config": { body: settings },
        "GET /customer-price-tables": { body: tables },
        "PUT /force-config": { body: { ...settings, maxDaysWithoutSync: 10, defaultPriceTableCode: 8 } },
      },
      role: "manager",
    });
    const days = await screen.findByLabelText(/Dias máximos sem sincronizar/);
    expect(days).toHaveValue("7");
    await waitFor(() => expect(within(screen.getByLabelText(/Tabela de preço padrão/)).getByRole("option", { name: "Atacado" })).toBeInTheDocument());
    await user.clear(days);
    await user.type(days, "99");
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("Informe de 1 a 60.")).toBeInTheDocument();
    expect(callsTo(calls, "PUT", "/force-config")).toHaveLength(0);
    await user.clear(days);
    await user.type(days, "10");
    await user.selectOptions(screen.getByLabelText(/Tabela de preço padrão/), "8");
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("Parâmetros salvos")).toBeInTheDocument();
    expect(callsTo(calls, "PUT", "/force-config")[0]?.body).toEqual({ maxDaysWithoutSync: 10, defaultPriceTableCode: 8 });
  });
});

describe("Descontos por representante", () => {
  const handlers = { ...shellData, "GET /sellers": { body: sellers }, "GET /seller-discount-rules": { body: { items: [rule] } } };

  it("lists the rules and filters by seller", async () => {
    const { user, calls } = renderApp("/descontos-representante", { handlers, role: "manager" });
    expect(await screen.findByText("Copo (7)")).toBeInTheDocument();
    expect(screen.getByText("12,5")).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByLabelText("Representante")).getByRole("option", { name: "Bruno Lima" })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Representante"), "4");
    await waitFor(() => expect(callsTo(calls, "GET", "/seller-discount-rules").some((call) => call.search.get("sellerCode") === "4")).toBe(true));
  });

  it("shows the empty state", async () => {
    renderApp("/descontos-representante", { handlers: { ...handlers, "GET /seller-discount-rules": { body: { items: [] } } }, role: "admin" });
    expect(await screen.findByText("Nenhuma regra")).toBeInTheDocument();
  });

  it("edits only the percent", async () => {
    const { user, calls } = renderApp("/descontos-representante", {
      handlers: { ...handlers, "PUT /seller-discount-rules/:id": { body: { ...rule, maxPercent: "15.0000" } } },
      role: "manager",
    });
    await user.click(await screen.findByRole("button", { name: "Editar" }));
    const input = await screen.findByLabelText(/Máximo/);
    await user.clear(input);
    await user.type(input, "15");
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(callsTo(calls, "PUT", `/seller-discount-rules/${rule.id}`)[0]?.body).toEqual({ maxPercent: "15" }));
  });

  it("deletes after confirmation", async () => {
    const { user, calls } = renderApp("/descontos-representante", { handlers: { ...handlers, "DELETE /seller-discount-rules/:id": { status: 204 } }, role: "manager" });
    await user.click(await screen.findByRole("button", { name: "Excluir" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(callsTo(calls, "DELETE", `/seller-discount-rules/${rule.id}`)).toHaveLength(1));
  });

  it("creates a general rule", async () => {
    const { user, calls } = renderApp("/descontos-representante", { handlers: { ...handlers, "POST /seller-discount-rules": { status: 201, body: { ...rule, targetKind: "none", targetCode: null, targetName: null } } }, role: "manager" });
    await user.click(await screen.findByRole("button", { name: "Nova regra" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: /Representante/ }));
    await user.click(await within(dialog).findByRole("option", { name: /Ana Souza/ }));
    await user.type(within(dialog).getByLabelText(/Máximo/), "8,5");
    await user.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(callsTo(calls, "POST", "/seller-discount-rules")[0]?.body).toEqual({ sellerCode: 3, targetKind: "none", targetCode: null, maxPercent: "8.5" }));
  });

  it("explains a duplicate", async () => {
    const { user } = renderApp("/descontos-representante", { handlers: { ...handlers, "POST /seller-discount-rules": { status: 409, body: { code: "conflict", message: "x" } } }, role: "manager" });
    await user.click(await screen.findByRole("button", { name: "Nova regra" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: /Representante/ }));
    await user.click(await within(dialog).findByRole("option", { name: /Ana Souza/ }));
    await user.type(within(dialog).getByLabelText(/Máximo/), "8");
    await user.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(await within(dialog).findByText(/Já existe uma regra/)).toBeInTheDocument();
  });
});
