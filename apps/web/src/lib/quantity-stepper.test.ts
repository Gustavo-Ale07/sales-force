import { describe, expect, it } from "vitest";
import { isRemovalText, stepQuantity } from "./quantity-stepper";

describe("stepQuantity", () => {
  it("adds and subtracts one step exactly", () => {
    expect(stepQuantity("2", 1)).toBe("3");
    expect(stepQuantity("2,5", 1)).toBe("3,5");
    expect(stepQuantity("0,1", 1, "0.2")).toBe("0,3");
    expect(stepQuantity("3", -1, "0.5")).toBe("2,5");
  });
  it("returns null (remove) at zero or below", () => {
    expect(stepQuantity("1", -1)).toBeNull();
    expect(stepQuantity("0,5", -1)).toBeNull();
  });
});

describe("isRemovalText", () => {
  it("treats empty and zero as removal only", () => {
    expect(isRemovalText("")).toBe(true);
    expect(isRemovalText(" 0 ")).toBe(true);
    expect(isRemovalText("0,0")).toBe(true);
    expect(isRemovalText("1")).toBe(false);
    expect(isRemovalText("abc")).toBe(false);
  });
});
