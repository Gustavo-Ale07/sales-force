import { apkUrl, checkAndUpdate, decideUpdate, manifestUrl, parseLatest, type UpdateIo, type UpdateStep } from "./apk-update";
import { Sha256 } from "./sha256";

const ascii = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));
const APK = ascii("pretend-apk-bytes");
const DIGEST = "86f8e4c4cc65bfe1b345f5a9938dea8d10d77af4b68c6c6a34a23dfe56e88cca";
const manifest = { channel: "staging", versionName: "0.2.0", versionCode: 12, minVersionCode: 10, file: "force-staging-12.apk", sha256: DIGEST, sizeBytes: APK.length };

function fakeIo(overrides: Partial<UpdateIo> & { bytes?: Uint8Array; manifest?: unknown } = {}) {
  const log: string[] = [];
  const bytes = overrides.bytes ?? APK;
  const io: UpdateIo = {
    fetchJson: async (url) => {
      log.push(`fetch ${url}`);
      return overrides.manifest ?? manifest;
    },
    download: async (url, onProgress) => {
      log.push(`download ${url}`);
      onProgress(bytes.length, bytes.length);
      return "/cache/x.apk";
    },
    fileSize: () => bytes.length,
    readChunks: (_p, chunk, consume) => {
      for (let i = 0; i < bytes.length; i += chunk) consume(bytes.subarray(i, i + chunk));
    },
    remove: (p) => log.push(`remove ${p}`),
    openInstaller: async (p) => {
      log.push(`install ${p}`);
    },
    ...overrides,
  };
  return { io, log };
}

const base = { sha256: () => new Sha256(), apiOrigin: "https://force.example.com", channel: "staging", installedVersionCode: 5 };

describe("manifest and decision", () => {
  it("accepts a valid manifest only for the expected channel", () => {
    expect(parseLatest(manifest, "staging")).toMatchObject({ versionCode: 12 });
    expect(parseLatest(manifest, "production")).toBeNull();
  });

  it.each([
    { file: "../x.apk" },
    { file: "https://evil/x.apk" },
    { sha256: "zz" },
    { minVersionCode: 99 },
    { versionCode: 0 },
    { sizeBytes: -1 },
  ])("rejects a tampered manifest %j", (patch) => {
    expect(parseLatest({ ...manifest, ...patch }, "staging")).toBeNull();
  });

  it("decides none / available / required", () => {
    const latest = parseLatest(manifest, "staging")!;
    expect(decideUpdate(12, latest)).toBe("none");
    expect(decideUpdate(13, latest)).toBe("none");
    expect(decideUpdate(10, latest)).toBe("available");
    expect(decideUpdate(9, latest)).toBe("required");
  });

  it("builds same-origin urls and refuses an odd channel name", () => {
    expect(manifestUrl("https://h", "staging")).toBe("https://h/downloads-files/latest-staging.json");
    expect(manifestUrl("https://h", "../x")).toBeNull();
    expect(apkUrl("https://h", parseLatest(manifest, "staging")!)).toBe("https://h/downloads-files/force-staging-12.apk");
  });
});

describe("checkAndUpdate", () => {
  it("downloads, verifies and opens the installer, reporting each step", async () => {
    const { io, log } = fakeIo();
    const steps: UpdateStep[] = [];
    const result = await checkAndUpdate({ ...base, io, onStep: (s) => steps.push(s) });
    expect(result.kind).toBe("installer-opened");
    expect(log.at(-1)).toBe("install /cache/x.apk");
    expect([...new Set(steps)]).toEqual(["checking", "downloading", "verifying", "installing"]);
  });

  it("does nothing when the app is current", async () => {
    const { io, log } = fakeIo();
    expect((await checkAndUpdate({ ...base, io, installedVersionCode: 12 })).kind).toBe("up-to-date");
    expect(log.some((l) => l.startsWith("download"))).toBe(false);
  });

  it("refuses a wrong digest, deletes the file and never opens the installer", async () => {
    const { io, log } = fakeIo({ bytes: ascii("tampered-apk-byte") });
    const result = await checkAndUpdate({ ...base, io });
    expect(result).toMatchObject({ kind: "failed", reason: "digest-mismatch" });
    expect(log).toContain("remove /cache/x.apk");
    expect(log.some((l) => l.startsWith("install"))).toBe(false);
  });

  it("refuses a wrong size before hashing", async () => {
    const { io, log } = fakeIo({ fileSize: () => 3 });
    expect(await checkAndUpdate({ ...base, io })).toMatchObject({ kind: "failed", reason: "size-mismatch" });
    expect(log.some((l) => l.startsWith("install"))).toBe(false);
  });

  it("refuses cleartext origins, a missing channel and a bad manifest", async () => {
    const { io } = fakeIo();
    expect(await checkAndUpdate({ ...base, io, apiOrigin: "http://force.example.com" })).toEqual({ kind: "unavailable", reason: "insecure-origin" });
    expect(await checkAndUpdate({ ...base, io, channel: undefined })).toEqual({ kind: "unavailable", reason: "no-channel" });
    const bad = fakeIo({ manifest: { nope: true } });
    expect(await checkAndUpdate({ ...base, io: bad.io })).toEqual({ kind: "unavailable", reason: "invalid-manifest" });
  });

  it("reports network failures without throwing", async () => {
    const { io } = fakeIo({ fetchJson: async () => { throw new Error("offline"); } });
    expect(await checkAndUpdate({ ...base, io })).toEqual({ kind: "unavailable", reason: "network" });
    const dl = fakeIo({ download: async () => { throw new Error("cut"); } });
    expect(await checkAndUpdate({ ...base, io: dl.io })).toMatchObject({ kind: "failed", reason: "download" });
  });

  it("asks before an optional update but never before a required one", async () => {
    const asked: string[] = [];
    const confirm = async (d: string) => { asked.push(d); return false; };
    const a = fakeIo();
    expect((await checkAndUpdate({ ...base, io: a.io, installedVersionCode: 11, confirm })).kind).toBe("skipped");
    const r = fakeIo();
    expect((await checkAndUpdate({ ...base, io: r.io, installedVersionCode: 5, confirm })).kind).toBe("installer-opened");
    expect(asked).toEqual(["available"]);
  });
});
