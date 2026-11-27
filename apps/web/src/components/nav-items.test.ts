import { describe, expect, it } from "vitest";
import { menuItemsFor, navItemsFor } from "./nav-items";

describe("navItemsFor", () => {
  it("gives every item a distinct icon and a label", () => {
    const items = navItemsFor(undefined);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.label).not.toBe("");
      expect(item.icon).toBeDefined();
    }
    expect(new Set(items.map((item) => item.icon)).size).toBe(items.length);
  });

  it("has no Aplicativo item and no route to /downloads for any role", () => {
    for (const role of [undefined, "seller", "manager", "admin"]) {
      const items = navItemsFor(role, true);
      expect(items.map((item) => item.label)).not.toContain("Aplicativo");
      expect(items.map((item) => item.to as string)).not.toContain("/downloads");
    }
  });

  it("shows Aguardando liberação only with the release-queue flag and a commercial role", () => {
    const labels = (role: string | undefined, approvals: boolean, queue: boolean) => navItemsFor(role, approvals, queue).map((item) => item.label);
    for (const role of ["seller", "manager", "admin"]) {
      expect(labels(role, true, true)).toContain("Aguardando liberação");
      expect(labels(role, true, false)).not.toContain("Aguardando liberação");
      expect(labels(role, false, true)).toContain("Aguardando liberação");
    }
    // The technical profile has no commercial areas (ROLE-1) and no role means no queue.
    expect(labels("technical", true, true)).not.toContain("Aguardando liberação");
    expect(labels(undefined, true, true)).not.toContain("Aguardando liberação");
    expect(navItemsFor("seller", false, true).map((item) => item.to)).toContain("/aguardando-liberacao");
  });

  it("keeps the top bar to the daily areas and moves every configuration item out of it", () => {
    const daily = ["Início", "Clientes", "Vendas", "Catálogo", "Tarefas", "Notificações"];
    const sellerDaily = ["Início", "Clientes", "Vendas", "Catálogo", "Tarefas", "Metas", "Notificações"];
    expect(navItemsFor("seller").map((item) => item.label)).toEqual(sellerDaily);
    expect(navItemsFor("seller", false, true).map((item) => item.label)).toEqual([...sellerDaily, "Aguardando liberação"]);
    expect(navItemsFor("manager").map((item) => item.label)).toEqual(daily);
    expect(navItemsFor("admin").map((item) => item.label)).toEqual(daily);
    expect(navItemsFor("manager", true, true).map((item) => item.label)).toEqual([...daily, "Aguardando liberação", "Aprovações"]);
    expect(navItemsFor("admin", true, true).map((item) => item.label)).toEqual([...daily, "Aguardando liberação", "Aprovações"]);
    expect(navItemsFor("technical", true, true).map((item) => item.label)).toEqual(["Integração", "Configurações"]);
    for (const role of ["seller", "manager", "admin"]) {
      const labels = navItemsFor(role, true, true).map((item) => item.label);
      if (role !== "seller") expect(labels).not.toContain("Metas");
      for (const configuration of ["Parâmetros", "Descontos por representante", "Limites de desconto", "Aparelhos", "Perfil"]) {
        expect(labels).not.toContain(configuration);
      }
    }
  });

  it("puts Parâmetros between Perfil and the rest of the avatar menu, for manager and administrator only", () => {
    const labels = (role: string | undefined, approvals = false) => menuItemsFor(role, approvals).map((item) => item.label);
    expect(labels("seller")).toEqual(["Perfil"]);
    expect(labels("operations")).toEqual(["Perfil"]);
    expect(labels("manager", true)).toEqual(["Perfil", "Parâmetros"]);
    expect(labels("admin", false)).toEqual(["Perfil", "Parâmetros", "Integração", "Configurações"]);
    expect(labels("admin", true)).toEqual(["Perfil", "Parâmetros", "Limites de desconto", "Integração", "Configurações"]);
  });
});
