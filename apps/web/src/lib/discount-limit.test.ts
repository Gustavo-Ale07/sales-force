import { describe, expect, it } from "vitest";
import { classifyBulk } from "./discount-limit";
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
  });

  it("ignores unchanged lines, lines without price and zero discounts", () => {
    const before = [line("a", "15", "12"), line("b", ""), line("c", "")];
    const after = [line("a", "15", "12"), line("b", "20", "12", false), line("c", "0", "12")];
    expect(classifyBulk(before, after)).toEqual({ within: 0, above: [] });
  });

  it("a limit exactly equal to the typed discount is within", () => {
    const result = classifyBulk([line("a", "")], [line("a", "12,0", "12")]);
    expect(result).toEqual({ within: 1, above: [] });
  });
});
