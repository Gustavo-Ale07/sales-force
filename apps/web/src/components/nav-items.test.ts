import { describe, expect, it } from "vitest";
import { navItemsFor } from "./nav-items";

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

  it("keeps the flag default off and the other items per role unchanged", () => {
    expect(navItemsFor("seller").map((item) => item.label)).toEqual(["Início", "Catálogo", "Clientes", "Vendas"]);
    expect(navItemsFor("seller", false, true).map((item) => item.label)).toEqual(["Início", "Catálogo", "Clientes", "Vendas", "Aguardando liberação"]);
    expect(navItemsFor("manager", true, true).map((item) => item.label)).toEqual(["Início", "Catálogo", "Clientes", "Vendas", "Aguardando liberação", "Aprovações"]);
    expect(navItemsFor("admin", true, true).map((item) => item.label)).toEqual([
      "Início", "Catálogo", "Clientes", "Vendas", "Aguardando liberação", "Aprovações", "Limites de desconto", "Integração", "Configurações",
    ]);
    expect(navItemsFor("technical", true, true).map((item) => item.label)).toEqual(["Integração", "Configurações"]);
  });

  it("keeps the Vidya order Início, Catálogo, Clientes, Vendas", () => {
    expect(navItemsFor(undefined).map((item) => item.label).slice(0, 4)).toEqual(["Início", "Catálogo", "Clientes", "Vendas"]);
  });
});
