import { describe, expect, it } from "vitest";
import { noPriceList, orderItem, pricedList, product, zeroList } from "../test/fixtures";
import {
  describeIssue,
  isLinePriceOrderable,
  lineFromOrderItem,
  lineFromProduct,
  listPriceOfLine,
  parseQuantityInput,
  previewDraft,
  summarizeCart,
  toRequestItems,
  type EditorLine,
} from "./order-draft";

const line = (overrides: Partial<EditorLine> = {}): EditorLine => ({
  key: "k",
  productCode: 1,
  description: "Item",
  unit: "UN",
  quantityText: "1",
  price: { state: "priced", unitPrice: "10", tableCode: 5, versionId: 9 },
  ...overrides,
});

describe("parseQuantityInput", () => {
  it.each([
    ["2", "2"],
    ["2,5", "2.5"],
    ["0,0001", "0.0001"],
  ])("accepts %s", (text, value) => {
    expect(parseQuantityInput(text)).toEqual({ ok: true, value });
  });

  it.each([
    ["", "empty"],
    ["  ", "empty"],
    ["2.5", "dot_separator"],
    ["abc", "not_a_decimal"],
    ["0", "not_positive"],
    ["1,00001", "too_many_decimals"],
  ])("rejects %j as %s", (text, problem) => {
    expect(parseQuantityInput(text)).toEqual({ ok: false, problem });
  });

  it("rejects a negative quantity", () => {
    expect(parseQuantityInput("-1").ok).toBe(false);
  });
});

describe("previewDraft (totals come from the domain, in decimal)", () => {
  it("multiplies without floating point error", () => {
    const preview = previewDraft([line({ quantityText: "3", price: { state: "priced", unitPrice: "0.1", tableCode: 5, versionId: 9 } })]);
    expect(preview.totals.estimatedTotal).toBe("0.30");
    expect(preview.valid).toBe(true);
  });

  it("sums lines and marks the total partial when a line has no price", () => {
    const preview = previewDraft([
      line({ key: "a", quantityText: "2", price: { state: "priced", unitPrice: "12.5", tableCode: 5, versionId: 9 } }),
      line({ key: "b", quantityText: "4", price: { state: "none", unitPrice: null, tableCode: 5, versionId: 9 } }),
    ]);
    expect(preview.totals).toMatchObject({ estimatedTotal: "25.00", lineCount: 2, unpricedLineCount: 1, isPartial: true });
    expect(preview.lines[1]?.item?.estimatedLineTotal).toBeNull();
  });

  it("counts an explicit zero price as priced, distinct from no price", () => {
    const preview = previewDraft([line({ price: { state: "zero", unitPrice: "0", tableCode: 5, versionId: 9 } })]);
    expect(preview.totals.unpricedLineCount).toBe(0);
  });

  it("is invalid while a quantity is invalid and leaves that line out of the total", () => {
    const preview = previewDraft([line({ quantityText: "x" }), line({ key: "b", quantityText: "2" })]);
    expect(preview.valid).toBe(false);
    expect(preview.lines[0]?.quantityProblem).toBe("not_a_decimal");
    expect(preview.totals.estimatedTotal).toBe("20.00");
  });

  it("never fabricates a price from inconsistent line data", () => {
    const preview = previewDraft([line({ price: { state: "priced", unitPrice: null, tableCode: 5, versionId: 9 } })]);
    expect(preview.lines[0]?.item?.priceState).toBe("none");
    expect(preview.totals.isPartial).toBe(true);
  });
});

describe("request items", () => {
  it("send product and quantity only, never a price", () => {
    expect(toRequestItems([line({ productCode: 7, quantityText: "1,5" }), line({ quantityText: "" })])).toEqual([
      { productCode: 7, quantity: "1.5" },
    ]);
  });
});

describe("lines", () => {
  it("starts a product line with quantity 1 and keeps the no-price reason", () => {
    const built = lineFromProduct(product({ listPrice: noPriceList("no_effective_version") }), "k");
    expect(built).toMatchObject({ quantityText: "1", price: { state: "none", unitPrice: null, reason: "no_effective_version" } });
  });

  it("restores a saved item with a decimal comma", () => {
    expect(lineFromOrderItem(orderItem({ quantity: "2.5" }), "k").quantityText).toBe("2,5");
  });

  it("round-trips list prices for display", () => {
    expect(listPriceOfLine(lineFromProduct(product({ listPrice: pricedList("12.5") }), "k").price)).toMatchObject({
      state: "priced",
      unitPrice: "12.5",
    });
    expect(listPriceOfLine(lineFromProduct(product({ listPrice: zeroList() }), "k").price)).toMatchObject({ state: "zero", unitPrice: "0" });
    expect(listPriceOfLine({ state: "priced", unitPrice: null, tableCode: 1, versionId: 1 }).state).toBe("none");
  });
});

describe("isLinePriceOrderable", () => {
  const config = (allowDraftWithoutPrice: boolean, orderable: boolean) => ({
    sales: { orderBehavior: { allowDraftWithoutPrice } },
    products: { productWithoutPrice: { orderable } },
  });

  it("always allows priced lines", () => {
    expect(isLinePriceOrderable("priced", config(false, false))).toBe(true);
  });

  it("follows the installation configuration for lines without price", () => {
    expect(isLinePriceOrderable("none", config(true, true))).toBe(true);
    expect(isLinePriceOrderable("none", config(false, true))).toBe(false);
    expect(isLinePriceOrderable("none", config(true, false))).toBe(false);
  });
});

describe("describeIssue", () => {
  it("names the item (1-based) and uses a pt-BR message", () => {
    expect(describeIssue({ path: "items[2]", code: "product_not_sellable" })).toBe("Item 3: Produto indisponível para venda.");
  });

  it("falls back to the server message, then a generic one, for unknown codes", () => {
    expect(describeIssue({ path: "notes", code: "novo_codigo", message: "Texto do servidor" })).toBe("Texto do servidor");
    expect(describeIssue({ path: "notes", code: "novo_codigo" })).toBe("Dado inválido.");
  });
});

describe("summarizeCart", () => {
  it("adds the valid quantities per unit without mixing units and counts invalid lines apart", () => {
    const lines = [
      line({ key: "a", quantityText: "2,5", unit: "UN" }),
      line({ key: "b", productCode: 2, quantityText: "1,5", unit: "UN" }),
      line({ key: "c", productCode: 3, quantityText: "3", unit: "KG" }),
      line({ key: "d", productCode: 4, quantityText: "", unit: "UN" }),
    ];
    const summary = summarizeCart(lines, previewDraft(lines).lines);
    expect(summary.lineCount).toBe(4);
    expect(summary.invalidLineCount).toBe(1);
    expect(summary.quantities).toEqual([
      { unit: "UN", quantity: "4" },
      { unit: "KG", quantity: "3" },
    ]);
  });

  it("is empty for an empty cart", () => {
    expect(summarizeCart([], [])).toEqual({ lineCount: 0, quantities: [], invalidLineCount: 0 });
  });
});
