import { bulkOverLimit, discountExceedsLimit, limitText, lineFromProduct, type EditorLine } from "./order-draft";
import { product } from "../test-doubles";
import { stepPercentText } from "../ui/bulk-discount-sheet";

const priced = { state: "priced", unitPrice: "10.00", tableCode: 1, versionId: 1 } as const;

function line(code: number, limit: string | null | undefined, discountText = ""): EditorLine {
  return { ...lineFromProduct(product(code, { listPrice: priced, ...(limit === undefined ? {} : { maxDiscountPercent: limit }) }), `k${code}`), discountText };
}

describe("discountExceedsLimit", () => {
  it("is true only above the product limit", () => {
    expect(discountExceedsLimit(line(4158, "12", "15"))).toBe(true);
    expect(discountExceedsLimit(line(4158, "12", "12"))).toBe(false);
    expect(discountExceedsLimit(line(4158, "12", "11,9"))).toBe(false);
  });

  it("never warns without a registered limit (null or absent)", () => {
    expect(discountExceedsLimit(line(4158, null, "50"))).toBe(false);
    expect(discountExceedsLimit(line(4158, undefined, "50"))).toBe(false);
  });

  it("ignores an empty or invalid text and a line without a price", () => {
    expect(discountExceedsLimit(line(4158, "12", ""))).toBe(false);
    expect(discountExceedsLimit(line(4158, "12", "abc"))).toBe(false);
    const noPrice: EditorLine = { ...line(4158, "12", "15"), price: { state: "none", tableCode: null, versionId: null, noPriceReason: "no_resolved_table" } };
    expect(discountExceedsLimit(noPrice)).toBe(false);
  });
});

describe("limitText", () => {
  it("shows the limit in pt-BR without trailing zeros", () => {
    expect(limitText("12")).toBe("12");
    expect(limitText("12.00")).toBe("12");
    expect(limitText("12.50")).toBe("12,5");
  });
});

describe("bulkOverLimit", () => {
  it("lists the changed lines above their limit and counts the changed ones within it", () => {
    const before = [line(4158, "12"), line(4159, "12"), line(1439, null), line(1437, "20")];
    const after: EditorLine[] = before.map((item) => ({ ...item, discountText: "15" }));
    const result = bulkOverLimit(before, after);
    expect(result.over.map((item) => item.key)).toEqual(["k4158", "k4159"]);
    expect(result.over[0]).toMatchObject({ limit: "12", typed: "15" });
    expect(result.within).toBe(2);
  });

  it("ignores lines the apply left untouched", () => {
    const before = [line(4158, "12"), line(4159, "12")];
    const after: EditorLine[] = before.map((item, index) => (index === 0 ? { ...item, discountText: "15" } : item));
    const result = bulkOverLimit(before, after);
    expect(result.over).toHaveLength(1);
    expect(result.within).toBe(0);
  });
});

describe("stepPercentText", () => {
  it("steps by one and clamps to 0..99", () => {
    expect(stepPercentText("", 1)).toBe("1");
    expect(stepPercentText("5", 1)).toBe("6");
    expect(stepPercentText("0", -1)).toBe("0");
    expect(stepPercentText("99", 1)).toBe("99");
  });
});
