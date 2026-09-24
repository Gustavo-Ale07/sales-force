import { resolveApiBaseUrl } from "./config";

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
