import { describe, expect, it } from "vitest";
import { classifyBulk, sellerLimitContext, withSellerLimit } from "./discount-limit";
import type { EditorLine } from "./order-draft";

const line = (key: string, discountText: string, maxDiscountPercent?: string | null, priced = true): EditorLine =>
  ({
    key,
    productCode: 1,
    description: `Produto ${key}`,
    unit: "UN",
    quantityText: "1",
    discountText,
    price: priced ? { state: "priced", unitPrice: "10", source: "list" } : { state: "none" },
    maxDiscountPercent,
  }) as unknown as EditorLine;

describe("classifyBulk", () => {
  it("only a product with a registered limit counts as above; null and absent limits are within", () => {
    const before = [line("a", ""), line("b", ""), line("c", ""), line("d", "")];
    const after = [line("a", "15", "12"), line("b", "15", null), line("c", "15", undefined), line("d", "10", "12")];
    const result = classifyBulk(before, after);
    expect(result.above).toEqual([{ name: "Produto a", limit: "12", typed: "15" }]);
    expect(result.within).toBe(3);
    expect(result.withinNames).toEqual(["Produto b", "Produto c", "Produto d"]);
  });

  it("ignores unchanged lines, lines without price and zero discounts", () => {
    const before = [line("a", "15", "12"), line("b", ""), line("c", "")];
    const after = [line("a", "15", "12"), line("b", "20", "12", false), line("c", "0", "12")];
    expect(classifyBulk(before, after)).toEqual({ within: 0, withinNames: [], above: [] });
  });

  it("a limit exactly equal to the typed discount is within", () => {
    const result = classifyBulk([line("a", "")], [line("a", "12,0", "12")]);
    expect(result).toEqual({ within: 1, withinNames: ["Produto a"], above: [] });
  });
});

describe("withSellerLimit (same domain resolver as the server and the app)", () => {
  const groups = [{ code: 10, parentCode: null }, { code: 11, parentCode: 10 }];
  const grouped = (max: string | null | undefined, group: number | null) => ({ ...line("a", "", max), group: { code: group, name: null } }) as EditorLine;

  it("without rules the ceiling stays the ERP one", () => {
    const line1 = grouped("5", 11);
    expect(withSellerLimit(line1, sellerLimitContext([], groups))).toBe(line1);
  });

  it("product > nearest group > general > ERP, and the ERP ceiling is kept for recomputation", () => {
    const ctx = (rules: { kind: "general" | "group" | "product"; code: number | null; percent: string }[]) => sellerLimitContext(rules, groups);
    expect(withSellerLimit(grouped("5", 11), ctx([{ kind: "group", code: 10, percent: "20" }]))?.maxDiscountPercent).toBe("20");
    expect(withSellerLimit(grouped("5", 11), ctx([{ kind: "group", code: 10, percent: "20" }, { kind: "group", code: 11, percent: "15" }]))?.maxDiscountPercent).toBe("15");
    expect(withSellerLimit(grouped("5", 11), ctx([{ kind: "product", code: 1, percent: "3" }, { kind: "group", code: 10, percent: "20" }]))?.maxDiscountPercent).toBe("3");
    expect(withSellerLimit(grouped("5", 99), ctx([{ kind: "general", code: null, percent: "7" }]))?.maxDiscountPercent).toBe("7");
    const once = withSellerLimit(grouped("5", 99), ctx([{ kind: "general", code: null, percent: "7" }]));
    expect(withSellerLimit(once, ctx([{ kind: "group", code: 40, percent: "2" }]))?.maxDiscountPercent).toBe("5");
  });

  it("a line whose ceiling is not known yet is left alone", () => {
    const unknown = grouped(undefined, 11);
    expect(withSellerLimit(unknown, sellerLimitContext([{ kind: "general", code: null, percent: "7" }], groups))).toBe(unknown);
  });
});
