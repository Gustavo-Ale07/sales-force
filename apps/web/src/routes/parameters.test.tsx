import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { openUserMenu, renderApp } from "../test/harness";
import { parameterTabsFor } from "./parameters";

const goals = {
  month: "2026-11",
  goalsSyncedAt: null,
  salesSyncedAt: null,
  total: { revenue: { target: null, realized: null, percent: null }, positivation: null },
  bySeller: [],
};
const handlers = {
  "GET /goals": { body: goals },
  "GET /seller-discount-rules": { body: { items: [] } },
  "GET /sellers": { body: { items: [] } },
  "GET /force-config": { body: { maxDaysWithoutSync: 7, defaultPriceTableCode: 5, updatedAt: "2026-11-01T00:00:00.000Z" } },
  "GET /customer-price-tables": { body: { items: [{ code: 5, name: "Varejo" }] } },
};

describe("parameterTabsFor", () => {
  it("offers Metas, Descontos and Geral to manager and administrator, nothing to others", () => {
    for (const role of ["admin", "manager"]) expect(parameterTabsFor(role).map((tab) => tab.label)).toEqual(["Metas", "Descontos", "Geral"]);
    expect(parameterTabsFor("seller")).toEqual([]);
  });
});

describe("Parâmetros (tabs)", () => {
  it("opens on Metas and moves between the tabs through ?aba=", async () => {
    const { router, user } = renderApp("/parametros", { handlers, role: "admin" });
    expect(await screen.findByRole("tab", { name: "Metas", selected: true })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Geral" }));
    expect(await screen.findByLabelText(/Dias máximos sem sincronizar/)).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ aba: "geral" });
    await user.click(screen.getByRole("tab", { name: "Descontos" }));
    expect(await screen.findByRole("button", { name: "Nova regra" })).toBeInTheDocument();
  });

  it("redirects the old routes into their tabs", async () => {
    const first = renderApp("/descontos-representante", { handlers, role: "manager" });
    expect(await screen.findByRole("tab", { name: "Descontos", selected: true })).toBeInTheDocument();
    expect(first.router.state.location.pathname).toBe("/parametros");
    first.unmount();
    const second = renderApp("/metas", { handlers, role: "admin" });
    expect(await screen.findByRole("tab", { name: "Metas", selected: true })).toBeInTheDocument();
    expect(second.router.state.location.pathname).toBe("/parametros");
  });

  it("keeps /metas for a seller (own result) and sends /aparelhos to the start page", async () => {
    const seller = renderApp("/metas", { handlers, role: "seller" });
    expect(await screen.findByRole("heading", { name: "Metas" })).toBeInTheDocument();
    expect(seller.router.state.location.pathname).toBe("/metas");
    seller.unmount();
    const devices = renderApp("/aparelhos", { handlers, role: "admin" });
    await waitFor(() => expect(devices.router.state.location.pathname).toBe("/"));
  });

  it("has no server-code tab or button: an old ?aba=codigo opens Geral", async () => {
    renderApp("/parametros?aba=codigo", { handlers, role: "admin" });
    expect(await screen.findByRole("tab", { name: "Geral", selected: true })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Código do servidor" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gerar novo código" })).not.toBeInTheDocument();
  });
});

describe("acesso por perfil", () => {
  it("does not offer Parâmetros to a seller and denies the direct URL", async () => {
    const { user } = renderApp("/metas", { handlers, role: "seller" });
    await screen.findByRole("button", { name: /Menu do usuário/ }, { timeout: 8000 });
    await openUserMenu(user);
    expect(await screen.findByRole("menuitem", { name: "Perfil" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Parâmetros" })).not.toBeInTheDocument();
  });

  it("offers Parâmetros between Perfil and Sair to a manager", async () => {
    const { user } = renderApp("/parametros", { handlers, role: "manager" });
    await screen.findByRole("button", { name: /Menu do usuário/ }, { timeout: 8000 });
    await openUserMenu(user);
    const names = (await screen.findAllByRole("menuitem")).map((item) => item.textContent);
    expect(names).toEqual(["Perfil", "Parâmetros", "Sair"]);
  });
});
