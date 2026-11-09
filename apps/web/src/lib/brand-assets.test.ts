import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_MARK_URL } from "./brand";

const webRoot = resolve(__dirname, "../..");
const pngSize = (file: string): { width: number; height: number; rgba: boolean } => {
  const bytes = readFileSync(resolve(webRoot, "public/brand", file));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), rgba: bytes[25] === 6 };
};

describe("brand assets published with the web app", () => {
  it("the default mark is the round P and every icon the page and manifest reference exists", () => {
    expect(DEFAULT_MARK_URL).toBe("/brand/icon-p.png");
    const html = readFileSync(resolve(webRoot, "index.html"), "utf8");
    const manifest = readFileSync(resolve(webRoot, "public/manifest.webmanifest"), "utf8");
    const referenced = [...html.matchAll(/href="(\/brand\/[^"]+\.png)"/g), ...manifest.matchAll(/"src": "(\/brand\/[^"]+\.png)"/g)].map((m) => m[1]!);
    expect(referenced).toEqual(
      expect.arrayContaining(["/brand/favicon-32.png", "/brand/favicon-48.png", "/brand/icon-192.png", "/brand/icon-512.png", "/brand/apple-touch-icon.png"]),
    );
    for (const path of referenced) expect(existsSync(resolve(webRoot, "public", path.slice(1))), path).toBe(true);
    expect(html).not.toContain("plac-mark-round");
  });

  it("sizes: round icons are RGBA (transparent corners), the apple-touch-icon is 180x180 and square", () => {
    expect(pngSize("icon-p.png")).toEqual({ width: 512, height: 512, rgba: true });
    expect(pngSize("icon-512.png")).toEqual({ width: 512, height: 512, rgba: true });
    expect(pngSize("icon-192.png")).toEqual({ width: 192, height: 192, rgba: true });
    expect(pngSize("favicon-48.png")).toEqual({ width: 48, height: 48, rgba: true });
    expect(pngSize("favicon-32.png")).toEqual({ width: 32, height: 32, rgba: true });
    expect(pngSize("apple-touch-icon.png")).toMatchObject({ width: 180, height: 180 });
  });
});
