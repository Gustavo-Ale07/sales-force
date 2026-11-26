import { filterSellers, foldText } from "./seller-search";

const sellers = [
  { code: 3, name: "Zélia Souza" },
  { code: 1, name: "ÁLVARO Lima" },
  { code: 2, name: "Marcos José" },
  { code: 4, name: "Ana Paula" },
];

describe("foldText", () => {
  it("ignores case and accents", () => {
    expect(foldText("  ÁLVARO  Çã ")).toBe("alvaro ca");
  });
});

describe("filterSellers", () => {
  it("without text returns everyone in alphabetical order, ignoring accents", () => {
    expect(filterSellers(sellers, "").map((s) => s.code)).toEqual([1, 4, 2, 3]);
  });

  it("matches part of the name regardless of case and accent", () => {
    expect(filterSellers(sellers, "alvaro").map((s) => s.code)).toEqual([1]);
    expect(filterSellers(sellers, "JOSE").map((s) => s.code)).toEqual([2]);
    expect(filterSellers(sellers, "zelia").map((s) => s.code)).toEqual([3]);
    expect(filterSellers(sellers, "an").map((s) => s.code)).toEqual([4]);
  });

  it("matches several words in any order", () => {
    expect(filterSellers(sellers, "paula ana").map((s) => s.code)).toEqual([4]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterSellers(sellers, "xyz")).toEqual([]);
  });

  it("does not change the input", () => {
    const copy = [...sellers];
    filterSellers(sellers, "");
    expect(sellers).toEqual(copy);
  });
});
