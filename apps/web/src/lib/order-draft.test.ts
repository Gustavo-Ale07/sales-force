import { describe, expect, it } from "vitest";
import { noPriceList, orderItem, pricedList, product, zeroList } from "../test/fixtures";
import {
  applyDiscount,
  describeIssue,
  issuesByLine,
  discountTextOf,
  isLinePriceOrderable,
  lineFromOrderItem,
  lineFromProduct,
  listPriceOfLine,
  parseDiscountInput,
  parseQuantityInput,
  quantityProblemText,
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

describe("parseQuantityInput with a selling step (AGRUPMIN)", () => {
  it("laminate with step 0,2: 0,2 and 0,6 are valid, 0,3 is not", () => {
    expect(parseQuantityInput("0,2", "0.2")).toEqual({ ok: true, value: "0.2" });
    expect(parseQuantityInput("0,6", "0.2")).toEqual({ ok: true, value: "0.6" });
    expect(parseQuantityInput("0,3", "0.2")).toEqual({ ok: false, problem: "quantity_step" });
  });
  it("napkin without step (null): hundredths are valid, thousandths are not", () => {
    expect(parseQuantityInput("0,01", null)).toEqual({ ok: true, value: "0.01" });
    expect(parseQuantityInput("0,5", null)).toEqual({ ok: true, value: "0.5" });
    expect(parseQuantityInput("0,005", null)).toEqual({ ok: false, problem: "quantity_step" });
  });
  it("unknown step (undefined) skips the check; the server decides", () => {
    expect(parseQuantityInput("0,005", undefined)).toEqual({ ok: true, value: "0.005" });
  });
  it("messages name the multiple", () => {
    expect(quantityProblemText("quantity_step", "0.2")).toBe("Este produto só vende em múltiplos de 0,2.");
    expect(quantityProblemText("quantity_step", null)).toBe("No máximo 2 casas decimais.");
  });
});

describe("parseQuantityInput", () => {
  it.each([
    ["2", "2"],
    ["2,5", "2.5"],
    ["0,0001", "0.0001"],
    ["0.0001", "0.0001"],
    ["0,2", "0.2"],
    ["0.2", "0.2"],
    ["1,5", "1.5"],
    ["1.5", "1.5"],
    [" 1.0 ", "1"],
    ["12,3456", "12.3456"],
  ])("accepts %s", (text, value) => {
    expect(parseQuantityInput(text)).toEqual({ ok: true, value });
  });

  it.each([
    ["", "empty"],
    ["  ", "empty"],
    ["abc", "not_a_decimal"],
    ["1.234,5", "not_a_decimal"],
    ["1,2,3", "not_a_decimal"],
    ["1..5", "not_a_decimal"],
    ["1.00001", "too_many_decimals"],
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

  it("carries the shared product photo metadata from a picked product and from a saved item, per product", () => {
    const imageA = { version: "a1", thumbnailUrl: "/api/v1/products/1/image?variant=thumb", url: "/api/v1/products/1/image?variant=full" };
    const imageB = { version: "b1", thumbnailUrl: "/api/v1/products/2/image?variant=thumb", url: "/api/v1/products/2/image?variant=full" };
    const lineA = lineFromProduct(product({ code: 1, image: imageA }), "a");
    const lineB = lineFromProduct(product({ code: 2, image: imageB }), "b");
    expect(lineA.image).toEqual(imageA);
    expect(lineB.image).toEqual(imageB);
    expect(lineFromProduct(product({ code: 3 }), "c").image).toBeNull();
    expect(lineFromOrderItem(orderItem({ productCode: 1, image: imageA }), "k").image).toEqual(imageA);
    expect(lineFromOrderItem(orderItem({ productCode: 9 }), "k").image).toBeNull();
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

  it("never orders a line without price, whatever the installation configuration says (owner ruling 2026-11-13)", () => {
    expect(isLinePriceOrderable("none", config(true, true))).toBe(false);
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

describe("catalog gate messages (owner ruling 2026-11-13)", () => {
  it("describes the price and mobility issues in pt-BR", () => {
    expect(describeIssue({ path: "items[0].priceState", code: "product_without_price" })).toBe("Item 1: Produto sem preço");
    expect(describeIssue({ path: "items[1].productCode", code: "product_without_mobility" })).toBe("Item 2: Produto sem mobilidade");
  });

  it("groups line issues by 0-based line index, leaves header issues out", () => {
    const byLine = issuesByLine([
      { path: "items[1].priceState", code: "product_without_price" },
      { path: "items[1].productCode", code: "product_without_mobility" },
      { path: "notes", code: "x", message: "y" },
    ]);
    expect([...byLine.keys()]).toEqual([1]);
    expect(byLine.get(1)).toEqual(["Produto sem preço", "Produto sem mobilidade"]);
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

  it("adds 0.2 steps without floating point error and prices them in decimal (laminated plates by pack)", () => {
    const priced = { state: "priced" as const, unitPrice: "10", tableCode: 5, versionId: 9 };
    const lines = [
      line({ key: "a", quantityText: "0,2", unit: "PT", price: priced }),
      line({ key: "b", productCode: 2, quantityText: "0.2", unit: "PT", price: priced }),
      line({ key: "c", productCode: 3, quantityText: "0,0001", unit: "PT", price: priced }),
    ];
    const preview = previewDraft(lines);
    expect(summarizeCart(lines, preview.lines).quantities).toEqual([{ unit: "PT", quantity: "0.4001" }]);
    expect(preview.totals.estimatedTotal).toBe("4.00");
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
    // D-AK: unit discount 0.35 x 15% = 0.0525 -> 0.05; 3 x (0.35 - 0.05) = 0.90
    expect(previewDraft([priced("a", "15", "0.35")]).lines[0]?.item?.estimatedLineTotal).toBe("0.90");
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

  it("whole order: the preview total after applying equals the sum of lines rounded per unit (D-AK), with and without a previous discount", () => {
    const odd = [
      line({ key: "p", quantityText: "3", discountText: "50", price: { state: "priced", unitPrice: "10.35", tableCode: 5, versionId: 9 } }),
      line({ key: "q", quantityText: "7", price: { state: "priced", unitPrice: "10.35", tableCode: 5, versionId: 9 } }),
    ];
    const applied = applyDiscount(odd, "5", () => true).lines;
    // unit discount 10.35 x 5% = 0.5175 -> 0.52 per unit (half-up); net unit 9.83; 3 x 9.83 = 29.49, 7 x 9.83 = 68.81
    expect(previewDraft(applied).totals.estimatedTotal).toBe("98.30");
    // 0% (empty text) removes every discount and returns to the list total: 10 x 10.35
    expect(previewDraft(applyDiscount(applied, "", () => true).lines).totals.estimatedTotal).toBe("103.50");
  });

  it("does not mutate the input", () => {
    applyDiscount(lines, "10", () => true);
    expect(lines.every((l) => l.discountText === "")).toBe(true);
  });
});

describe("estimated IPI in the preview (D-D)", () => {
  it("estimates from the net line total with the product reference and sums the order", () => {
    const preview = previewDraft([
      line({ key: "a", quantityText: "1", price: { state: "priced", unitPrice: "16.43", tableCode: 5, versionId: 9 }, ipi: { status: "rate", percentual: "9.75" } }),
      line({ key: "b", quantityText: "2", discountText: "10", price: { state: "priced", unitPrice: "50", tableCode: 5, versionId: 9 }, ipi: { status: "rate", percentual: "3.25" } }),
    ]);
    expect(preview.ipi.ipiEstimated).toBe("4.53");
    expect(preview.ipi.grandTotalEstimated).toBe("110.96");
    expect(preview.ipi.isPartial).toBe(false);
  });

  it("a line without a reference or by tariff is flagged, never a silent zero", () => {
    const preview = previewDraft([
      line({ key: "a", price: { state: "priced", unitPrice: "10", tableCode: 5, versionId: 9 } }),
      line({ key: "b", price: { state: "priced", unitPrice: "10", tableCode: 5, versionId: 9 }, ipi: { status: "tariff" } }),
    ]);
    expect(preview.ipi).toMatchObject({ unavailableLineCount: 1, tariffLineCount: 1, isPartial: true, ipiEstimated: "0.00" });
  });

  it("lineFromOrderItem keeps the server IPI result as a reference", () => {
    const base = { lineNo: 1, productCode: 1, productDescription: "x", unit: "UN", quantity: "1", unitListPrice: "10", priceState: "priced", priceTableCode: 5, priceVersionId: 9, discountPercent: "0", estimatedLineTotal: "10.00" } as const;
    expect(lineFromOrderItem({ ...base, ipi: { status: "estimated", amount: "0.33", percentual: "3.25" } } as never, "k").ipi).toEqual({ status: "rate", percentual: "3.25" });
    expect(lineFromOrderItem({ ...base, ipi: { status: "tariff" } } as never, "k").ipi).toEqual({ status: "tariff" });
    expect(lineFromOrderItem(base as never, "k").ipi).toEqual({ status: "unavailable" });
  });
});
