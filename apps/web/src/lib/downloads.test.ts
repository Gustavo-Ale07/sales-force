import { describe, expect, it } from "vitest";
import { formatSize, loadDownloads, parseDownloadItem, parseDownloads } from "./downloads";

const SHA = "a".repeat(64);
const valid = {
  id: "android-staging",
  platform: "android",
  channel: "staging",
  label: "Force (Android)",
  versionName: "0.1.0",
  versionCode: 12,
  minVersionCode: 10,
  file: "force-staging-12.apk",
  sha256: SHA,
  sizeBytes: 52_428_800,
  publishedAt: "2026-11-11T12:00:00Z",
  notes: "Correções.",
};

describe("downloads.json parsing", () => {
  it("maps a valid entry to a same-origin url", () => {
    expect(parseDownloadItem(valid)).toMatchObject({ url: "/downloads-files/force-staging-12.apk", versionCode: 12, minVersionCode: 10 });
  });

  it.each([
    ["path traversal", { file: "../x.apk" }],
    ["sub-folder", { file: "a/b.apk" }],
    ["absolute url", { file: "https://evil.example/x.apk" }],
    ["not an apk", { file: "x.exe" }],
    ["short digest", { sha256: "abc" }],
    ["uppercase digest", { sha256: "A".repeat(64) }],
    ["unknown platform", { platform: "ios" }],
    ["zero version code", { versionCode: 0 }],
    ["minimum above the version", { minVersionCode: 99 }],
    ["bad id", { id: "A B" }],
  ])("drops an entry with %s", (_name, patch) => {
    expect(parseDownloadItem({ ...valid, ...patch })).toBeNull();
  });

  it("defaults the minimum to 1 and tolerates missing optional fields", () => {
    const { minVersionCode: _m, notes: _n, publishedAt: _p, ...rest } = valid;
    expect(parseDownloadItem(rest)).toMatchObject({ minVersionCode: 1, notes: null, publishedAt: null });
  });

  it("orders newest first, drops invalid entries and survives malformed documents", () => {
    const items = parseDownloads({ items: [{ ...valid, id: "a", versionCode: 3, minVersionCode: 1 }, { nope: true }, { ...valid, id: "b", versionCode: 9, minVersionCode: 1 }] });
    expect(items.map((i) => i.id)).toEqual(["b", "a"]);
    for (const bad of [null, 1, "x", [], {}, { items: "x" }]) expect(parseDownloads(bad)).toEqual([]);
  });

  it("treats 404 as an empty list but fails loudly on real errors", async () => {
    const as = (fn: () => Promise<Response>) => fn as unknown as typeof fetch;
    expect(await loadDownloads(as(async () => new Response("", { status: 404 })))).toEqual([]);
    await expect(loadDownloads(as(async () => new Response("", { status: 500 })))).rejects.toThrow();
    await expect(loadDownloads(as(async () => new Response("<html>", { status: 200 })))).rejects.toThrow();
    await expect(loadDownloads(as(async () => Promise.reject(new TypeError("network"))))).rejects.toThrow();
    const ok = (async () => new Response(JSON.stringify({ items: [valid] }), { status: 200 })) as unknown as typeof fetch;
    expect(await loadDownloads(ok)).toHaveLength(1);
  });

  it("formats sizes in pt-BR", () => {
    expect(formatSize(52_428_800)).toBe("50,0 MB");
    expect(formatSize(2048)).toBe("2 KB");
  });
});
