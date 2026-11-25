import { priceOriginLabel, pricesOriginText } from "./prices-origin";

describe("prices origin wording (same as the site)", () => {
  it("names the table, its name and the kind", () => {
    const origin = { source: "catalog_reference", tableCode: 5, tableName: "Tabela Base" } as const;
    expect(pricesOriginText(origin)).toBe("Preços da tabela 5 — Tabela Base (tabela de referência do catálogo).");
    expect(priceOriginLabel(origin)).toBe("Tabela 5 — Tabela Base (tabela de referência do catálogo)");
  });

  it("omits the name when the table has none", () => {
    const origin = { source: "customer", tableCode: 7, tableName: null } as const;
    expect(pricesOriginText(origin)).toBe("Preços da tabela 7 (tabela do cliente).");
    expect(priceOriginLabel(origin)).toBe("Tabela 7 (tabela do cliente)");
  });

  it("says no table applies when there is none", () => {
    const origin = { source: "none", tableCode: null, tableName: null } as const;
    expect(pricesOriginText(origin)).toBe("Nenhuma tabela de preço se aplica a esta consulta; os produtos aparecem como “Sem preço”.");
    expect(priceOriginLabel(origin)).toBe("nenhuma tabela");
  });
});
