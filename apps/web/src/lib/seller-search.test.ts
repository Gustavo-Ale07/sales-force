import { describe, expect, it } from "vitest";
import { filterSellers, normalizeSearch } from "./seller-search";

const sellers = [
  { code: 3, name: "José Álvares", active: true },
  { code: 1, name: "ana paula", active: true },
  { code: 2, name: "Zélia Souza", active: true },
  { code: 4, name: "Ângela Inativa", active: false },
  { code: 5, name: "Bruno", active: true },
];

describe("normalizeSearch", () => {
  it("ignores case, accents and surrounding spaces", () => {
    expect(normalizeSearch("  JOSÉ Ålvares ")).toBe("jose alvares");
  });
});

describe("filterSellers", () => {
  it("returns every active seller in alphabetical order without text", () => {
    expect(filterSellers(sellers, "").map((s) => s.code)).toEqual([1, 5, 3, 2]);
  });
  it("matches part of the name without case or accent", () => {
    expect(filterSellers(sellers, "JOSE").map((s) => s.code)).toEqual([3]);
    expect(filterSellers(sellers, "alv").map((s) => s.code)).toEqual([3]);
    expect(filterSellers(sellers, "ZELIA").map((s) => s.code)).toEqual([2]);
  });
  it("returns an empty list when nothing matches and hides inactive sellers", () => {
    expect(filterSellers(sellers, "xyz")).toEqual([]);
    expect(filterSellers(sellers, "angela")).toEqual([]);
  });
});
