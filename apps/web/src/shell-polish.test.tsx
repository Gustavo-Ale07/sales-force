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

  it("returns focus to the trigger button after closing, whether opened by click or by the Ctrl+K shortcut", async () => {
    // The palette is manually controlled (no Dialog.Trigger), so Radix has no trigger to restore
    // focus to on its own; without command-menu.tsx wiring triggerRef, focus falls through to <body>.
    const { user } = renderApp("/", { handlers: shellData });
    const trigger = await screen.findByRole("button", { name: /Ir para…/ });

    await user.click(trigger);
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());

    trigger.focus();
    await user.keyboard("{Control>}k{/Control}");
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
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

  it("collapses the horizontal nav into the drawer at lg, not md, so it never contests 768-1023px with the admin integration badge's full label", async () => {
    renderApp("/", { handlers: shellData });
    const drawerTrigger = await screen.findByRole("button", { name: "Abrir menu de navegação" });
    expect(drawerTrigger.className).toContain("lg:hidden");
    expect(drawerTrigger.className).not.toContain("md:hidden");

    const navs = screen.getAllByRole("navigation", { name: "Principal" });
    const horizontalNav = navs.find((nav) => nav.className.includes("lg:flex"));
    expect(horizontalNav).toBeDefined();
    expect(horizontalNav?.className).not.toContain("md:flex");
  });
});

describe("login screen", () => {
  it("follows the approved reference: hero column, welcome heading, icon fields and the primary action", async () => {
    renderApp("/login", { signedIn: false, config: { installationName: "Instalação Teste" } });
    expect(await screen.findByRole("heading", { name: "Bem-vindo(a)!", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Acesse sua conta para continuar.")).toBeInTheDocument();
    expect(screen.getByText("Plataforma comercial")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Venda com agilidade/ })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Usuário")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Senha")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Entrar" })).toBeInTheDocument();
    expect(screen.queryByText(/^Sales Force$/i)).not.toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Instalação Teste"));
  });
});
