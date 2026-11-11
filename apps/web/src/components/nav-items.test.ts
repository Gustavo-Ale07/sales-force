import { describe, expect, it } from "vitest";
import { navItemsFor } from "./nav-items";

describe("navItemsFor (ROLE-1: convenience only, the server enforces)", () => {
  it("leaves approvals and discount limits out unless the installation runs the Force approval flow (D-M)", () => {
    expect(navItemsFor("admin").map((item) => item.to)).not.toContain("/limites-desconto");
    expect(navItemsFor("manager").map((item) => item.to)).not.toContain("/aprovacoes");
    expect(navItemsFor("admin", true).map((item) => item.to)).toEqual(expect.arrayContaining(["/limites-desconto", "/aprovacoes"]));
  });

  it("offers the app download link to the commercial profiles, never to the technical one", () => {
    for (const role of ["admin", "manager", "seller"]) expect(navItemsFor(role).map((item) => item.to)).toContain("/downloads");
    expect(navItemsFor("technical").map((item) => item.to)).not.toContain("/downloads");
  });

  it("shows the technical profile only the integration and settings pages", () => {
    expect(navItemsFor("technical").map((item) => item.to)).toEqual(["/integracao", "/configuracoes"]);
  });

  it("keeps the commercial areas for admin, manager and seller, and integration only for admin", () => {
    expect(navItemsFor("admin").map((item) => item.to)).toContain("/integracao");
    for (const role of ["manager", "seller"]) {
      const items = navItemsFor(role).map((item) => item.to);
      expect(items).not.toContain("/integracao");
      expect(items.length).toBeGreaterThan(0);
    }
  });
});
