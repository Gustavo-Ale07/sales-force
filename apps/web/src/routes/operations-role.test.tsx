import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { navItemsFor } from "../components/nav-items";
import { toAuthUser } from "../lib/api-auth-client";
import { customersPage, dashboard, ordersPage } from "../test/fixtures";
import { openUserMenu, renderApp, type Handlers } from "../test/harness";

const queue = { items: [], page: 1, pageSize: 25, total: 0 };
const counts = { total: 0, sectors: [{ sector: "Financeiro", count: 0 }], lastCheckedAt: "2026-11-23T15:30:00.000Z" };

const handlers = (): Handlers => ({
  "GET /release-queue": { body: queue },
  "GET /release-queue/count": { body: counts },
  "GET /dashboard": { body: dashboard() },
  "GET /customers": { body: customersPage([]) },
  "GET /orders": { body: ordersPage([]) },
});

const ALLOWED = ["/auth/session", "/release-queue", "/release-queue/count"];

describe("Perfil Operações", () => {
  it("labels the role Operações", () => {
    const user = toAuthUser({ id: "0190a000-0000-7000-8000-000000000001", username: "op", displayName: "Op", role: "operations", sellerCodes: [] } as never);
    expect(user.roleLabel).toBe("Operações");
  });

  it("navItemsFor gives only the release queue, whatever the flags", () => {
    expect(navItemsFor("operations", true, false).map((item) => item.to)).toEqual(["/aguardando-liberacao"]);
    expect(navItemsFor("operations", false, true).map((item) => item.to)).toEqual(["/aguardando-liberacao"]);
  });

  it("lands on the release queue after login and shows only that menu item", async () => {
    const { router } = renderApp("/", { handlers: handlers(), role: "operations" });
    const nav = await screen.findByRole("navigation", { name: "Principal" });
    expect(await within(nav).findByRole("link", { name: /Aguardando liberação/ })).toBeInTheDocument();
    expect(within(nav).getAllByRole("link")).toHaveLength(1);
    await waitFor(() => expect(router.state.location.pathname).toBe("/aguardando-liberacao"));
  });

  it.each(["/pedidos", "/clientes", "/produtos", "/aprovacoes", "/integracao", "/configuracoes", "/perfil", "/pedidos/novo"])(
    "redirects %s to the release queue",
    async (path) => {
      const { router } = renderApp(path, { handlers: handlers(), role: "operations" });
      await waitFor(() => expect(router.state.location.pathname).toBe("/aguardando-liberacao"));
    },
  );

  it("calls only the session and the queue, and the user menu offers only logout (no profile, no refresh)", async () => {
    const { calls, user } = renderApp("/aguardando-liberacao", { handlers: handlers(), role: "operations" });
    await screen.findByRole("heading", { name: /Aguardando liberação/ });
    await openUserMenu(user);
    expect(await screen.findByRole("menuitem", { name: "Sair" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Atualizar dados" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Sair" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Meu perfil" })).toBeNull();
    expect(calls.map((call) => call.path).filter((path) => !ALLOWED.includes(path))).toEqual([]);
  });
});
