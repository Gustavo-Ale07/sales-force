import { createMobileApiClient } from "../data/api";
import { scriptedFetch, type Responder } from "../test-support";
import { createHttpAuth } from "./http-auth";

const BASE = "http://api.test/api/v1";
const account = {
  id: "0190a0c0-0000-7000-8000-000000000001",
  username: "ana.vendas",
  displayName: "Ana",
  role: "seller",
  sellerCodes: [7],
};
const session = { authenticated: true, authMode: "dev", account, expiresAt: "2026-09-24T20:00:00.000Z" };

function authWith(respond: Responder) {
  const scripted = scriptedFetch(respond);
  return { auth: createHttpAuth(createMobileApiClient(BASE, { fetch: scripted.fetch })), requests: scripted.requests };
}

describe("createHttpAuth", () => {
  it("posts the credentials to /auth/login and returns the account", async () => {
    const { auth, requests } = authWith(() => ({ status: 200, body: session }));
    const result = await auth.login({ username: "usuario.teste", password: "segredo" });
    expect(result).toEqual({ ok: true, account });
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: `${BASE}/auth/login`,
      body: { username: "usuario.teste", password: "segredo" },
    });
    expect(requests[0]?.body).not.toHaveProperty("email");
    // A native client sends no Origin header; the server's CSRF layer accepts that case (see the mobile plan).
    expect(requests[0]?.headers.get("origin")).toBeNull();
  });

  it.each([
    [400, { ok: false, reason: "invalid_credentials" }],
    [401, { ok: false, reason: "invalid_credentials" }],
    [403, { ok: false, reason: "unavailable" }],
    [503, { ok: false, reason: "unavailable" }],
  ])("maps a login answered with HTTP %i", async (status, expected) => {
    const { auth } = authWith(() => ({ status, body: { code: "x", message: "y" } }));
    await expect(auth.login({ username: "ana", password: "p" })).resolves.toEqual(expected);
  });

  it("reports the retry delay of a rate-limited login", async () => {
    const { auth } = authWith(() => ({
      status: 429,
      body: { code: "rate_limited", message: "x" },
      headers: { "retry-after": "30" },
    }));
    await expect(auth.login({ username: "ana", password: "p" })).resolves.toEqual({
      ok: false,
      reason: "rate_limited",
      retryAfterSeconds: 30,
    });
  });

  it("maps a transport failure during login to 'unavailable'", async () => {
    const { auth } = authWith(() => new Error("network down"));
    await expect(auth.login({ username: "ana", password: "p" })).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("reads the current session and treats an anonymous answer as no session", async () => {
    const live = authWith(() => ({ status: 200, body: session }));
    await expect(live.auth.getSession()).resolves.toEqual(account);
    expect(live.requests[0]).toMatchObject({ method: "GET", url: `${BASE}/auth/session` });

    const anonymous = authWith(() => ({ status: 200, body: { authenticated: false, authMode: "dev" } }));
    await expect(anonymous.auth.getSession()).resolves.toBeNull();

    const unauthorized = authWith(() => ({ status: 401, body: { code: "unauthenticated", message: "x" } }));
    await expect(unauthorized.auth.getSession()).resolves.toBeNull();
  });

  it("throws when the session probe cannot reach the server", async () => {
    const { auth } = authWith(() => new Error("network down"));
    await expect(auth.getSession()).rejects.toMatchObject({ status: 0 });
  });

  it("logs out and tolerates an already-gone session", async () => {
    const ok = authWith(() => ({ status: 204 }));
    await expect(ok.auth.logout()).resolves.toBeUndefined();
    expect(ok.requests[0]).toMatchObject({ method: "POST", url: `${BASE}/auth/logout` });

    const gone = authWith(() => ({ status: 401, body: { code: "unauthenticated", message: "x" } }));
    await expect(gone.auth.logout()).resolves.toBeUndefined();
  });
});
