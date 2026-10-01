import { allowsCleartext, resolveApiBaseUrl } from "./config";

describe("resolveApiBaseUrl", () => {
  it("appends the API base path to a plain origin", () => {
    expect(resolveApiBaseUrl("http://192.168.0.10:3000")).toEqual({ ok: true, baseUrl: "http://192.168.0.10:3000/api/v1" });
    expect(resolveApiBaseUrl(" HTTPS://api.example.com ")).toEqual({ ok: true, baseUrl: "https://api.example.com/api/v1" });
  });

  it("reports a missing value", () => {
    expect(resolveApiBaseUrl(undefined)).toEqual({ ok: false, reason: "missing" });
    expect(resolveApiBaseUrl("  ")).toEqual({ ok: false, reason: "missing" });
  });

  it.each(["api.example.com", "ftp://host", "https://host/path", "https://user:pw@host", "https://host?x=1", "https://ho st"])(
    "refuses %j instead of guessing",
    (value) => {
      expect(resolveApiBaseUrl(value)).toEqual({ ok: false, reason: "invalid" });
    },
  );
});

describe("resolveApiBaseUrl cleartext policy", () => {
  it("accepts http only when cleartext is explicitly allowed (development)", () => {
    expect(resolveApiBaseUrl("http://192.168.0.10:3000", { allowCleartext: true })).toEqual({ ok: true, baseUrl: "http://192.168.0.10:3000/api/v1" });
    expect(resolveApiBaseUrl("http://192.168.0.10:3000", { allowCleartext: false })).toEqual({ ok: false, reason: "insecure" });
    expect(resolveApiBaseUrl(" HTTP://api.example.com ", { allowCleartext: false })).toEqual({ ok: false, reason: "insecure" });
  });

  it("always accepts https, in release as well", () => {
    expect(resolveApiBaseUrl("https://api.example.com", { allowCleartext: false })).toEqual({ ok: true, baseUrl: "https://api.example.com/api/v1" });
  });

  it("still reports missing/invalid before the cleartext verdict", () => {
    expect(resolveApiBaseUrl(undefined, { allowCleartext: false })).toEqual({ ok: false, reason: "missing" });
    expect(resolveApiBaseUrl("ftp://host", { allowCleartext: false })).toEqual({ ok: false, reason: "invalid" });
  });

  it("defaults to the build mode: this test run is a development run, so http is accepted without options", () => {
    expect(__DEV__).toBe(true);
    expect(resolveApiBaseUrl("http://10.0.0.5:3000").ok).toBe(true);
  });
});

describe("allowsCleartext", () => {
  const off = { dev: false, cleartextFlag: undefined, buildProfile: undefined };

  it("is on in development (__DEV__)", () => {
    expect(allowsCleartext({ ...off, dev: true })).toBe(true);
  });

  it("in a release bundle needs BOTH the cleartext flag and the explicit dev profile", () => {
    expect(allowsCleartext({ ...off, cleartextFlag: "1", buildProfile: "dev" })).toBe(true);
    expect(allowsCleartext({ ...off, cleartextFlag: "1" })).toBe(false);
    expect(allowsCleartext({ ...off, buildProfile: "dev" })).toBe(false);
  });

  it("fails closed for production, staging, unknown profiles and non-exact flag values", () => {
    for (const buildProfile of ["production", "staging", "preview", "", "development "]) {
      expect(allowsCleartext({ ...off, cleartextFlag: "1", buildProfile })).toBe(false);
    }
    for (const cleartextFlag of ["0", "true", "yes", ""]) {
      expect(allowsCleartext({ ...off, cleartextFlag, buildProfile: "dev" })).toBe(false);
    }
  });

  it("refuses an http origin in a release bundle built for staging or production even with the flag set", () => {
    const staging = allowsCleartext({ ...off, cleartextFlag: "1", buildProfile: "staging" });
    expect(resolveApiBaseUrl("http://10.0.0.5:3000", { allowCleartext: staging })).toEqual({ ok: false, reason: "insecure" });
  });
});
