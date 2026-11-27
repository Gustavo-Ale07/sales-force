import { describe, expect, it } from "vitest";
import { emptyRuleForm, formatPercent, groupsOfKind, normalizePercent, percentProblem, ruleProblems, ruleTargetLabel, toCreateBody } from "./discount-rules";

describe("discount rule helpers", () => {
  it("accepts 0 to 100 with up to four decimals and the comma", () => {
    for (const ok of ["0", "10", "12,5", "99.9999", "100", "100.00"]) expect(percentProblem(ok)).toBeNull();
    for (const bad of ["", "abc", "101", "10.12345", "-1"]) expect(percentProblem(bad)).not.toBeNull();
    expect(normalizePercent(" 4,5 ")).toBe("4.5");
  });

  it("formats the percent in pt-BR without trailing zeros", () => {
    expect(formatPercent("12.5000")).toBe("12,5");
    expect(formatPercent("10.0000")).toBe("10");
    expect(formatPercent("7")).toBe("7");
  });

  it("separates groups from subgroups by the parent", () => {
    const groups = [
      { code: 1, name: "A", parentCode: null, degree: 1, hasChildren: true, subtreeCodes: [1, 2] },
      { code: 2, name: "B", parentCode: 1, degree: 2, hasChildren: false, subtreeCodes: [2] },
    ];
    expect(groupsOfKind(groups, "group").map((g) => g.code)).toEqual([1]);
    expect(groupsOfKind(groups, "subgroup").map((g) => g.code)).toEqual([2]);
  });

  it("requires seller, target (except general) and percent", () => {
    expect(Object.keys(ruleProblems(emptyRuleForm()))).toEqual(["seller", "percent"]);
    expect(ruleProblems({ sellerCode: "3", targetKind: "product", targetCode: null, percent: "5" })).toEqual({ target: "Selecione o alvo." });
    expect(ruleProblems({ sellerCode: "3", targetKind: "none", targetCode: null, percent: "5" })).toEqual({});
  });

  it("builds the create body with a null target for the general rule", () => {
    expect(toCreateBody({ sellerCode: "3", targetKind: "none", targetCode: "9", percent: "5,5" })).toEqual({ sellerCode: 3, targetKind: "none", targetCode: null, maxPercent: "5.5" });
    expect(toCreateBody({ sellerCode: "3", targetKind: "group", targetCode: "9", percent: "5" })).toEqual({ sellerCode: 3, targetKind: "group", targetCode: 9, maxPercent: "5" });
  });

  it("labels the target", () => {
    expect(ruleTargetLabel({ targetKind: "none", targetCode: null, targetName: null })).toBe("Geral");
    expect(ruleTargetLabel({ targetKind: "product", targetCode: 7, targetName: "Copo" })).toBe("Copo (7)");
  });
});
