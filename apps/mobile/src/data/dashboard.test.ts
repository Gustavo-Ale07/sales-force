import { indicatorsOf } from "./dashboard";

const groups = [
  { key: "portfolio", metrics: [{ key: "customers_total", value: { kind: "count", value: 1250 } }] },
  { key: "catalog", metrics: [{ key: "products_visible", value: { kind: "count", value: 373 } }, { key: "products_sellable", value: null }] },
  { key: "orders", metrics: [{ key: "drafts", value: { kind: "count", value: 4 } }, { key: "drafts_estimated_total", value: { kind: "money", value: "1234.5" } }] },
] as const;

describe("indicatorsOf", () => {
  it("takes the five counters of the site's Início, formatted in pt-BR; a missing or null metric is null, never zero", () => {
    expect(indicatorsOf(groups)).toMatchObject({ customers: "1.250", products: "373", sellable: null, openOrders: "4", unsentAmount: "R$ 1.234,50" });
    expect(indicatorsOf([]).openOrders).toBeNull();
  });
});

describe("indicatorsOf portfolio", () => {
  it("keeps the server's own labels for the Carteira group", () => {
    const found = indicatorsOf([{ key: "portfolio", metrics: [{ key: "customers_total", label: "Clientes na carteira", value: { kind: "count", value: 1250 } }] }]);
    expect(found.portfolio).toEqual([{ key: "customers_total", label: "Clientes na carteira", value: "1.250" }]);
  });
});
