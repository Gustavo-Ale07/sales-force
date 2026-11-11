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

  it("keeps the Vidya order Início, Catálogo, Clientes, Vendas", () => {
    expect(navItemsFor(undefined).map((item) => item.label).slice(0, 4)).toEqual(["Início", "Catálogo", "Clientes", "Vendas"]);
  });
});
