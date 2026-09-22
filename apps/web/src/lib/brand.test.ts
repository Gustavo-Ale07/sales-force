import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyBrand, contrastWithWhite, deriveAccentTokens, parseAccent, parseBrandAsset } from "./brand";

describe("parseBrandAsset", () => {
  it.each(["/brand/logo.svg", "/brand/mark-2.png", "/brand/Logo_Plac.webp", "/brand/a.jpg"])("accepts %s", (value) => {
    expect(parseBrandAsset(value)).toBe(value);
  });

  it.each([
    "https://evil.example/logo.png",
    "//evil.example/logo.png",
    "javascript:alert(1)",
    "data:image/svg+xml;base64,AAAA",
    "/brand/../config.json",
    "/brand/sub/logo.png",
    "/other/logo.png",
    "/brand/logo.html",
    "/brand/.png",
    "/brand/logo.png?x=1",
    "/brand/logo.png#a",
    "/brand/lo go.png",
    "/brand/logo\n.png",
    "brand/logo.png",
    "",
    42,
    null,
    undefined,
    {},
  ])("rejects %j", (value) => {
    expect(parseBrandAsset(value)).toBeNull();
  });

  it("rejects an absurdly long name", () => {
    expect(parseBrandAsset(`/brand/${"a".repeat(200)}.png`)).toBeNull();
  });
});

describe("parseAccent", () => {
  it("accepts a six digit hex color with enough contrast against white and lowercases it", () => {
    expect(parseAccent("#0B6560")).toBe("#0b6560");
    expect(parseAccent("#1a237e")).toBe("#1a237e");
  });

  it.each(["#fff", "#ffffff80", "0b6560", "red", "rgb(0,0,0)", "#0b6560; background:url(x)", "url(javascript:1)", "#gggggg", 7, null, undefined])(
    "rejects the malformed value %j",
    (value) => {
      expect(parseAccent(value)).toBeNull();
    },
  );

  it("rejects colors that are too light to read as text on the pale surfaces (5.5:1 against white)", () => {
    expect(parseAccent("#2f8f83")).toBeNull();
    expect(parseAccent("#ffff00")).toBeNull();
    expect(parseAccent("#f5a623")).toBeNull();
    expect(contrastWithWhite("#000000")).toBeCloseTo(21, 0);
    expect(contrastWithWhite("#ffffff")).toBeCloseTo(1, 5);
  });
});

describe("deriveAccentTokens", () => {
  it("derives hover, weak and text tones from the accent", () => {
    const tokens = deriveAccentTokens("#0b6560");
    expect(tokens.accent).toBe("#0b6560");
    for (const value of Object.values(tokens)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
    // Hover and text are darker than the accent; weak is a light wash.
    expect(contrastWithWhite(tokens.hover)).toBeGreaterThan(contrastWithWhite(tokens.accent));
    expect(contrastWithWhite(tokens.text)).toBeGreaterThan(contrastWithWhite(tokens.hover));
    expect(contrastWithWhite(tokens.weak)).toBeLessThan(1.4);
  });
});

describe("applyBrand", () => {
  it("does nothing when the installation has no brand", () => {
    const root = document.createElement("html");
    applyBrand({ logoUrl: null, markUrl: null, accent: null }, root);
    expect(root.getAttribute("style")).toBeNull();
  });

  it("sets the accent tokens through the style object, never through markup", () => {
    const root = document.createElement("html");
    applyBrand({ logoUrl: null, markUrl: null, accent: "#1a237e" }, root);
    expect(root.style.getPropertyValue("--sf-accent")).toBe("#1a237e");
    expect(root.style.getPropertyValue("--sf-accent-hover")).toMatch(/^#[0-9a-f]{6}$/);
    expect(root.style.getPropertyValue("--sf-accent-weak")).toMatch(/^#[0-9a-f]{6}$/);
    expect(root.style.getPropertyValue("--sf-accent-text")).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("default design tokens", () => {
  const css = readFileSync(resolve(import.meta.dirname, "../../../../packages/ui/src/styles/index.css"), "utf8");
  const token = (name: string) => new RegExp(String.raw`--sf-${name}:\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1] ?? "";

  it("keeps the default accent and its derived tones readable as text and as a button background", () => {
    expect(contrastWithWhite(token("accent"))).toBeGreaterThanOrEqual(5.5);
    expect(contrastWithWhite(token("accent-hover"))).toBeGreaterThanOrEqual(5.5);
    expect(contrastWithWhite(token("accent-text"))).toBeGreaterThanOrEqual(7);
  });

  it("accepts its own default accent as a valid brand accent", () => {
    expect(parseAccent(token("accent"))).toBe(token("accent").toLowerCase());
  });
});
