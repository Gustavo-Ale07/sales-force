import { orderItem, product } from "../test-doubles";
import {
  applyDiscount,
  describeIssue,
  discountProblemMessages,
  discountTextOf,
  incrementLineQuantity,
  isLinePriceOrderable,
  lineAmountsOf,
  lineFromOrderItem,
  lineFromProduct,
  parseDiscountInput,
  parseQuantityInput,
  previewDraft,
  quantityProblemMessages,
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
    ["-1", "negative"],
  ])("rejects %j as %s", (text, problem) => {
    expect(parseQuantityInput(text)).toEqual({ ok: false, problem });
  });

  it("has a pt-BR message for every problem", () => {
    for (const key of Object.keys(quantityProblemMessages)) {
      expect(quantityProblemMessages[key as keyof typeof quantityProblemMessages]).toEqual(expect.any(String));
    }
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

  it("has a pt-BR message for every problem", () => {
    for (const key of Object.keys(discountProblemMessages)) {
      expect(discountProblemMessages[key as keyof typeof discountProblemMessages]).toEqual(expect.any(String));
    }
  });

  it("shows a stored percentage with a decimal comma and no discount as empty", () => {
    expect(discountTextOf("0")).toBe("");
    expect(discountTextOf("12.5")).toBe("12,5");
  });
});

describe("lineFromProduct", () => {
  it("starts a product line with quantity 1, no discount and the product's list price", () => {
    const built = lineFromProduct(
      product(1, { description: "Copo 200 ml", unit: "UN", listPrice: { state: "priced", unitPrice: "9.9", tableCode: 1, versionId: 2 } }),
      "k",
    );
    expect(built).toMatchObject({
      key: "k",
      productCode: 1,
      description: "Copo 200 ml",
      unit: "UN",
      quantityText: "1",
      discountText: "",
      price: { state: "priced", unitPrice: "9.9" },
    });
  });

  it("keeps the no-price reason", () => {
    const built = lineFromProduct(
      product(2, { listPrice: { state: "none", tableCode: null, versionId: null, noPriceReason: "no_effective_version" } }),
      "k",
    );
    expect(built.price).toMatchObject({ state: "none", noPriceReason: "no_effective_version" });
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
      line({ key: "b", quantityText: "4", price: { state: "none", tableCode: null, versionId: null, noPriceReason: "no_price_row" } }),
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
    const preview = previewDraft([
      line({ discountText: "10", price: { state: "none", tableCode: 5, versionId: 9, noPriceReason: "no_price_row" } }),
    ]);
    expect(preview.valid).toBe(true);
    expect(preview.discounts.discountedLineCount).toBe(0);
  });
});

describe("lineAmountsOf", () => {
  it("reports the list subtotal, the amount discounted and the line total", () => {
    const preview = previewDraft([line({ quantityText: "3", discountText: "10", price: { state: "priced", unitPrice: "10", tableCode: 5, versionId: 9 } })]);
    expect(lineAmountsOf(preview.lines[0]!)).toEqual({ subtotal: "30.00", discountAmount: "3.00", lineTotal: "27.00" });
  });

  it("has no amounts for a line without a price", () => {
    const preview = previewDraft([line({ price: { state: "none", tableCode: null, versionId: null, noPriceReason: "no_resolved_table" } })]);
    expect(lineAmountsOf(preview.lines[0]!)).toEqual({ subtotal: null, discountAmount: null, lineTotal: null });
  });

  it("has no amounts for a line with an invalid quantity", () => {
    const preview = previewDraft([line({ quantityText: "abc" })]);
    expect(lineAmountsOf(preview.lines[0]!)).toEqual({ subtotal: null, discountAmount: null, lineTotal: null });
  });
});

describe("request items", () => {
  it("send product, quantity and discount only, never a price", () => {
    expect(
      toRequestItems([
        line({ productCode: 7, quantityText: "1,5", discountText: "12,5" }),
        line({ key: "b", productCode: 8, discountText: "0" }),
        line({ key: "c", quantityText: "" }),
      ]),
    ).toEqual([
      { productCode: 7, quantity: "1.5", discountPercent: "12.5" },
      { productCode: 8, quantity: "1" },
    ]);
  });

  it("never sends a discount on a line without a price", () => {
    expect(
      toRequestItems([line({ discountText: "10", price: { state: "none", tableCode: 5, versionId: 9, noPriceReason: "no_price_row" } })]),
    ).toEqual([{ productCode: 1, quantity: "1" }]);
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

describe("incrementLineQuantity", () => {
  it("adds one unit to a valid quantity, in decimal", () => {
    expect(incrementLineQuantity(line({ quantityText: "2,5" })).quantityText).toBe("3,5");
  });

  it("treats an invalid quantity as zero before adding", () => {
    expect(incrementLineQuantity(line({ quantityText: "abc" })).quantityText).toBe("1");
  });

  it("does not change any other field of the line", () => {
    const original = line({ quantityText: "1", discountText: "10" });
    expect(incrementLineQuantity(original)).toMatchObject({ ...original, quantityText: "2" });
  });
});

describe("applyDiscount (mass and group/subset apply share this iteration)", () => {
  it("sets the discount text on every matching, priced line and counts how many changed", () => {
    const lines = [
      line({ key: "a", discountText: "" }),
      line({ key: "b", discountText: "5" }),
      line({ key: "c", price: { state: "none", tableCode: null, versionId: null, noPriceReason: "no_price_row" } }),
    ];
    const result = applyDiscount(lines, "10", () => true);
    expect(result.applied).toBe(2);
    expect(result.lines.map((l) => l.discountText)).toEqual(["10", "10", ""]);
  });

  it("only touches lines the matcher selects (group/subset apply)", () => {
    const lines = [line({ key: "a" }), line({ key: "b" }), line({ key: "c" })];
    const selected = new Set(["a", "c"]);
    const result = applyDiscount(lines, "20", (l) => selected.has(l.key));
    expect(result.applied).toBe(2);
    expect(result.lines.find((l) => l.key === "a")?.discountText).toBe("20");
    expect(result.lines.find((l) => l.key === "b")?.discountText).toBe("");
    expect(result.lines.find((l) => l.key === "c")?.discountText).toBe("20");
  });

  it("never discounts a line without a price even when it matches", () => {
    const lines = [line({ key: "a", price: { state: "none", tableCode: null, versionId: null, noPriceReason: "no_resolved_table" } })];
    const result = applyDiscount(lines, "10", () => true);
    expect(result.applied).toBe(0);
    expect(result.lines[0]?.discountText).toBe("");
  });

  it("removes discounts on the matched lines when applied with an empty text", () => {
    const lines = [line({ key: "a", discountText: "15" }), line({ key: "b", discountText: "15" })];
    const result = applyDiscount(lines, "", (l) => l.key === "a");
    expect(result.applied).toBe(1);
    expect(result.lines.find((l) => l.key === "a")?.discountText).toBe("");
    expect(result.lines.find((l) => l.key === "b")?.discountText).toBe("15");
  });
});

describe("lineFromOrderItem (loading a saved draft for editing)", () => {
  it("carries the product, quantity, discount and price of a priced line", () => {
    const built = lineFromOrderItem(
      orderItem({ productCode: 9, productDescription: "Vela", unit: "CX", quantity: "2.5", discountPercent: "7.5", unitListPrice: "4", priceTableCode: 2, priceVersionId: 3 }),
      "k",
    );
    expect(built).toEqual({
      key: "k",
      productCode: 9,
      description: "Vela",
      unit: "CX",
      quantityText: "2,5",
      discountText: "7,5",
      price: { state: "priced", unitPrice: "4", tableCode: 2, versionId: 3 },
    });
  });

  it("shows no discount for a stored '0' percentage", () => {
    const built = lineFromOrderItem(orderItem({ discountPercent: "0" }), "k");
    expect(built.discountText).toBe("");
  });

  it("treats a line without a price as 'none', never fabricating a value", () => {
    const built = lineFromOrderItem(
      orderItem({ priceState: "none", unitListPrice: null, priceTableCode: null, priceVersionId: null }),
      "k",
    );
    expect(built.price).toEqual({ state: "none", tableCode: null, versionId: null, noPriceReason: "no_price_row" });
  });
});

describe("quantity change preserves the line's discount (discount and quantity are independent fields)", () => {
  it("changing quantityText never touches discountText", () => {
    const original = line({ quantityText: "1", discountText: "12,5" });
    const changed = { ...original, quantityText: "5" };
    expect(changed.discountText).toBe("12,5");
    expect(previewDraft([changed]).lines[0]?.item?.discountPercent).toBe("12.5");
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
