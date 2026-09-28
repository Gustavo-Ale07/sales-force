import { describe, expect, it } from "vitest";
import { noPriceList, orderItem, pricedList, product, zeroList } from "../test/fixtures";
import {
  applyDiscount,
  describeIssue,
  discountTextOf,
  isLinePriceOrderable,
  lineFromOrderItem,
  lineFromProduct,
  listPriceOfLine,
  parseDiscountInput,
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
  discountText: "",
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

describe("parseDiscountInput", () => {
  it.each([
    ["", "0"],
    ["  ", "0"],
    ["10", "10"],
    ["12,5", "12.5"],
    ["7,25%", "7.25"],
    ["7 %", "7"],
    ["0", "0"],
    ["99,99", "99.99"],
  ])("accepts %j as %s", (text, value) => {
    expect(parseDiscountInput(text)).toEqual({ ok: true, value });
  });

  it.each([
    ["12.5", "dot_separator"],
    ["abc", "not_a_decimal"],
    ["-1", "negative"],
    ["1,234", "too_many_decimals"],
    ["100", "out_of_range"],
  ])("rejects %j as %s", (text, problem) => {
    expect(parseDiscountInput(text)).toEqual({ ok: false, problem });
  });

  it("shows a stored percentage with a decimal comma and no discount as empty", () => {
    expect(discountTextOf("0")).toBe("");
    expect(discountTextOf("12.5")).toBe("12,5");
  });
});

describe("discounts in the preview", () => {
  const priced = (key: string, discountText: string, unitPrice = "10", quantityText = "3") =>
    line({ key, discountText, quantityText, price: { state: "priced", unitPrice, tableCode: 5, versionId: 9 } });

  it("takes the percentage off the line and reports the subtotal and the discounts", () => {
    const preview = previewDraft([priced("a", "10"), priced("b", "")]);
    expect(preview.lines[0]?.item?.estimatedLineTotal).toBe("27.00");
    expect(preview.totals.estimatedTotal).toBe("57.00");
    expect(preview.discounts).toEqual({ listTotal: "60.00", discountTotal: "3.00", discountedLineCount: 1 });
  });

  it("rounds each line once, half-up", () => {
    // 3 x 0.35 = 1.05; 15% off = 0.8925 -> 0.89
    expect(previewDraft([priced("a", "15", "0.35")]).lines[0]?.item?.estimatedLineTotal).toBe("0.89");
  });

  it("flags an invalid discount on that line only and keeps it out of the sum", () => {
    const preview = previewDraft([priced("a", "abc"), priced("b", "10")]);
    expect(preview.valid).toBe(false);
    expect(preview.lines[0]).toMatchObject({ item: null, discountProblem: "not_a_decimal" });
    expect(preview.totals.estimatedTotal).toBe("27.00");
  });

  it("ignores a discount typed on a line without a price", () => {
    const preview = previewDraft([line({ discountText: "10", price: { state: "none", unitPrice: null, tableCode: 5, versionId: 9 } })]);
    expect(preview.valid).toBe(true);
    expect(preview.discounts.discountedLineCount).toBe(0);
  });

  it("sends the discount only when there is one on a priced line", () => {
    const none = { state: "none", unitPrice: null, tableCode: 5, versionId: 9 } as const;
    expect(
      toRequestItems([
        priced("a", "12,5"),
        priced("b", ""),
        priced("c", "0"),
        line({ key: "d", productCode: 9, discountText: "10", price: none }),
      ]),
    ).toEqual([
      { productCode: 1, quantity: "3", discountPercent: "12.5" },
      { productCode: 1, quantity: "3" },
      { productCode: 1, quantity: "3" },
      { productCode: 9, quantity: "1" },
    ]);
  });

  it("restores the discount of a saved item", () => {
    expect(lineFromOrderItem(orderItem({ discountPercent: "12.5" }), "k").discountText).toBe("12,5");
    expect(lineFromOrderItem(orderItem(), "k").discountText).toBe("");
  });
});

describe("applyDiscount", () => {
  const priced = (key: string, group: EditorLine["group"]) =>
    line({ key, group, price: { state: "priced", unitPrice: "10", tableCode: 5, versionId: 9 } });
  const noPrice = line({ key: "n", group: { code: 1, name: "Balões" }, price: { state: "none", unitPrice: null, tableCode: 5, versionId: 9 } });
  const lines = [priced("a", { code: 1, name: "Balões" }), priced("b", { code: 2, name: "Velas" }), noPrice, priced("c", undefined)];

  it("mass: every priced line, never one without a price", () => {
    const result = applyDiscount(lines, "10", () => true);
    expect(result.applied).toBe(3);
    expect(result.lines.map((l) => l.discountText)).toEqual(["10", "10", "", "10"]);
  });

  it("group: only the lines of the group", () => {
    const result = applyDiscount(lines, "5,5", (l) => l.group?.code === 1);
    expect(result.applied).toBe(1);
    expect(result.lines.map((l) => l.discountText)).toEqual(["5,5", "", "", ""]);
  });

  it("the last action wins and an empty text removes the discount", () => {
    const first = applyDiscount(lines, "10", () => true).lines;
    const second = applyDiscount(first, "20", (l) => l.group?.code === 2).lines;
    expect(second.map((l) => l.discountText)).toEqual(["10", "20", "", "10"]);
    expect(applyDiscount(second, "", () => true).lines.every((l) => l.discountText === "")).toBe(true);
  });

  it("does not mutate the input", () => {
    applyDiscount(lines, "10", () => true);
    expect(lines.every((l) => l.discountText === "")).toBe(true);
  });
});
