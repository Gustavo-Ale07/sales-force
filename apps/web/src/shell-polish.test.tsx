import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { customersPage, customerDetail, dashboard, ordersPage } from "./test/fixtures";
import { renderApp } from "./test/harness";

const shellData = {
  "GET /dashboard": { body: dashboard() },
  "GET /customers": { body: customersPage([]) },
  "GET /customers/:code": { body: customerDetail() },
  "GET /orders": { body: ordersPage([]) },
};

describe("quick navigation (Ctrl K)", () => {
  it("opens with Ctrl+K, filters pages, opens the highlighted one with Enter and closes", async () => {
    const { user, router } = renderApp("/", { handlers: shellData });
    expect(await screen.findByRole("heading", { name: "Início", level: 1 })).toBeInTheDocument();

    await user.keyboard("{Control>}k{/Control}");
    const search = await screen.findByRole("combobox");
    expect(search).toHaveFocus();
    expect(screen.getByRole("option", { name: "Novo pedido" })).toBeInTheDocument();

    await user.type(search, "client");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await user.keyboard("{Enter}");

    await waitFor(() => expect(router.state.location.pathname).toBe("/clientes"));
    await waitFor(() => expect(screen.queryByRole("combobox")).not.toBeInTheDocument());
  });

  it("only lists pages and actions, shows an empty state and closes with Escape", async () => {
    const { user } = renderApp("/", { handlers: shellData });
    await screen.findByRole("heading", { name: "Início", level: 1 });

    await user.click(screen.getByRole("button", { name: /Ir para…/ }));
    const dialog = await screen.findByRole("dialog");
    const groups = within(dialog).getAllByRole("group");
    expect(groups.map((group) => group.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Novo pedido")]));

    await user.type(within(dialog).getByRole("combobox"), "cliente 1001");
    expect(within(dialog).getByRole("status")).toHaveTextContent("Nenhuma página ou ação encontrada.");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("notifications bell", () => {
  it("shows only the empty state, with no badge or counter", async () => {
    const { user } = renderApp("/", { handlers: shellData });
    const bell = await screen.findByRole("button", { name: "Notificações" });
    expect(bell).toHaveTextContent("");
    await user.click(bell);
    expect(await screen.findByText("Você não possui novas notificações.")).toBeInTheDocument();
  });
});

describe("top bar and navigation", () => {
  it("shows the user as an avatar only, keeping the accessible name", async () => {
    renderApp("/", { handlers: shellData });
    const trigger = await screen.findByRole("button", { name: /Menu do usuário/ });
    expect(trigger.textContent?.trim().length).toBeLessThanOrEqual(2);
  });

  it("offers a back link to the parent page on detail pages", async () => {
    renderApp("/clientes/1001", { handlers: shellData });
    const nav = await screen.findByRole("navigation", { name: /Trilha de navegação/ });
    expect(within(nav).getByRole("link", { name: "Clientes" })).toHaveAttribute("href", "/clientes");
  });
});

describe("login screen", () => {
  it("is one centered form with the product subtitle and no product-name line under the logo", async () => {
    renderApp("/login", { signedIn: false, config: { installationName: "Instalação Teste" } });
    expect(await screen.findByRole("heading", { name: "Entrar", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Força de Vendas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Entrar" })).toBeInTheDocument();
    expect(screen.queryByText(/^Sales Force$/i)).not.toBeInTheDocument();
  });
});
