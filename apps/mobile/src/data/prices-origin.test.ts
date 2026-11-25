import { priceOriginLabel } from "./prices-origin";

describe("price origin wording (same as the site)", () => {
  it("names the table, its name and the kind", () => {
    expect(priceOriginLabel({ source: "catalog_reference", tableCode: 5, tableName: "Tabela Base" })).toBe("Tabela 5 — Tabela Base (tabela de referência do catálogo)");
  });

  it("omits the name when the table has none", () => {
    expect(priceOriginLabel({ source: "customer", tableCode: 7, tableName: null })).toBe("Tabela 7 (tabela do cliente)");
  });

  it("says no table applies when there is none", () => {
    expect(priceOriginLabel({ source: "none", tableCode: null, tableName: null })).toBe("nenhuma tabela");
  });
});
