import { describeListPrice, formatBrl } from "./money";

describe("formatBrl", () => {
  it.each([
    ["0", "R$ 0,00"],
    ["12", "R$ 12,00"],
    ["12.5", "R$ 12,50"],
    ["1234.5", "R$ 1.234,50"],
    ["1234567.891234", "R$ 1.234.567,891234"],
    ["0.005", "R$ 0,005"],
    ["12.500000", "R$ 12,50"],
  ])("formats %s as %s", (input, expected) => {
    expect(formatBrl(input)).toBe(expected);
  });

  it.each(["", "abc", "-1", "1,5", "1e3", "1.2.3"])("rejects %j", (input) => {
    expect(formatBrl(input)).toBeNull();
  });
});

describe("describeListPrice", () => {
  it("shows a resolved price", () => {
    expect(describeListPrice({ state: "priced", unitPrice: "19.9", tableCode: 1, versionId: 2 })).toBe("R$ 19,90");
  });

  it("shows an explicit zero row as zero", () => {
    expect(describeListPrice({ state: "zero", unitPrice: "0", tableCode: 1, versionId: 2 })).toBe("R$ 0,00");
  });

  it("never turns a missing price into zero", () => {
    const text = describeListPrice({
      state: "none",
      tableCode: null,
      versionId: null,
      noPriceReason: "no_resolved_table",
    });
    expect(text).toBe("Sem preço");
  });
});
