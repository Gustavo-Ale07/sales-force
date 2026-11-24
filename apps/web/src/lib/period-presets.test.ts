import { describe, expect, it } from "vitest";
import { detectPreset, presetRange, todayInSaoPaulo } from "./period-presets";

describe("period presets (same ranges as the app)", () => {
  const today = "2026-03-02";
  it("computes inclusive calendar ranges", () => {
    expect(presetRange("today", today)).toEqual({ from: "2026-03-02", to: "2026-03-02" });
    expect(presetRange("7d", today)).toEqual({ from: "2026-02-24", to: "2026-03-02" });
    expect(presetRange("30d", today)).toEqual({ from: "2026-02-01", to: "2026-03-02" });
    expect(presetRange("all", today)).toEqual({});
  });
  it("detects the preset from the URL dates", () => {
    expect(detectPreset(undefined, undefined, today)).toBe("all");
    expect(detectPreset("2026-03-02", "2026-03-02", today)).toBe("today");
    expect(detectPreset("2026-02-24", "2026-03-02", today)).toBe("7d");
    expect(detectPreset("2026-01-01", undefined, today)).toBe("custom");
  });
  it("reads today in the business time zone", () => {
    expect(todayInSaoPaulo(new Date("2026-03-02T02:00:00Z"))).toBe("2026-03-01");
  });
});
