import { describe, expect, it, vi } from "vitest";
import { errorStatus } from "./http-error";
import { shouldRetry } from "./query-client";
import { defaultRuntimeConfig, loadRuntimeConfig, parseRuntimeConfig } from "./runtime-config";
import { isSafeRedirect, safeRedirect } from "./safe-redirect";

describe("safeRedirect", () => {
  it.each(["/", "/clientes", "/pedidos/novo?x=1"])("accepts %s", (value) => {
    expect(safeRedirect(value)).toBe(value);
  });
  it.each(["https://evil.example", "//evil.example", "/\\evil", "javascript:alert(1)", "", "clientes", "/login", "/a\nb", 42, null])(
    "rejects %s",
    (value) => {
      expect(isSafeRedirect(value)).toBe(false);
    },
  );
});

describe("runtime config", () => {
  it("falls back to dev (fail-visible) for invalid input", () => {
    expect(parseRuntimeConfig(null)).toEqual(defaultRuntimeConfig);
    expect(parseRuntimeConfig({ installationName: 42, authMode: "prod" })).toEqual(defaultRuntimeConfig);
  });
  it("accepts a valid file", () => {
    expect(parseRuntimeConfig({ installationName: " Acme ", authMode: "standard" })).toEqual({
      installationName: "Acme",
      authMode: "standard",
      brand: { logoUrl: null, markUrl: null, accent: null },
    });
  });
  it("reads the installation brand and drops each invalid part on its own", () => {
    const parsed = parseRuntimeConfig({
      installationName: "Acme",
      authMode: "standard",
      brand: { logoUrl: "/brand/logo.svg", markUrl: "https://evil.example/x.png", accent: "#1A237E" },
    });
    expect(parsed.brand).toEqual({ logoUrl: "/brand/logo.svg", markUrl: null, accent: "#1a237e" });
  });
  it("ignores a brand that is not an object", () => {
    for (const brand of ["x", 1, null, [], undefined]) {
      expect(parseRuntimeConfig({ installationName: "Acme", authMode: "standard", brand }).brand).toEqual(defaultRuntimeConfig.brand);
    }
  });
  it("uses defaults when the file is unreachable or not ok", async () => {
    expect(await loadRuntimeConfig(vi.fn().mockRejectedValue(new Error("offline")))).toEqual(defaultRuntimeConfig);
    expect(await loadRuntimeConfig(vi.fn().mockResolvedValue({ ok: false }))).toEqual(defaultRuntimeConfig);
  });
});

describe("query retry policy", () => {
  it("never retries client errors and retries transient ones twice", () => {
    expect(shouldRetry(0, { status: 401 })).toBe(false);
    expect(shouldRetry(0, { status: 403 })).toBe(false);
    expect(shouldRetry(0, { status: 503 })).toBe(true);
    expect(shouldRetry(2, { status: 503 })).toBe(false);
    expect(errorStatus(new Error("x"))).toBeUndefined();
  });
});
