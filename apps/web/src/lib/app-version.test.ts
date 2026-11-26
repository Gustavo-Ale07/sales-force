import { describe, expect, it } from "vitest";
import { buildVersionLabel } from "./app-version";

describe("buildVersionLabel", () => {
  it("appends the short commit", () => {
    expect(buildVersionLabel("0.2.0", "a1b2c3d4e5f6a7b8c9d0")).toBe("0.2.0 · a1b2c3d");
  });
  it("falls back to the version alone when the commit is absent or invalid", () => {
    expect(buildVersionLabel("0.2.0", "")).toBe("0.2.0");
    expect(buildVersionLabel("0.2.0", "unknown")).toBe("0.2.0");
  });
});
