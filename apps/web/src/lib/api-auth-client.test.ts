import { describe, expect, it } from "vitest";
import { account } from "../test/fixtures";
import { apiError, createMockApi, session, type Handlers } from "../test/harness";
import { createWebApiClient } from "./api";
import { createApiAuthClient } from "./api-auth-client";

function clientWith(handlers: Handlers) {
  const mock = createMockApi(handlers);
  return { client: createApiAuthClient(createWebApiClient({ origin: "http://localhost", fetch: mock.fetch })), calls: mock.calls };
}

describe("API-backed AuthClient", () => {
  it("returns the signed-in user with the role label", async () => {
    const { client } = clientWith({ "GET /auth/session": session(true) });
    await expect(client.getSession()).resolves.toEqual({
      id: account.id,
      name: "Ana Souza",
      username: "ana.vendas",
      role: "seller",
      roleLabel: "Vendedor",
      sellerCodes: [7],
    });
  });

  it("returns null for an anonymous session and for a 401", async () => {
    await expect(clientWith({ "GET /auth/session": session(false) }).client.getSession()).resolves.toBeNull();
    await expect(clientWith({ "GET /auth/session": apiError(401, "unauthenticated", "x") }).client.getSession()).resolves.toBeNull();
  });

  it("propagates a server failure of the session probe instead of treating it as anonymous", async () => {
    const { client } = clientWith({ "GET /auth/session": apiError(503, "service_unavailable", "x") });
    await expect(client.getSession()).rejects.toMatchObject({ status: 503 });
  });

  it("sends the credentials in the body only", async () => {
    const { client, calls } = clientWith({ "POST /auth/login": session(true) });
    const result = await client.login({ username: "ana.teste", password: "segredo" });
    expect(result.ok).toBe(true);
    const request = calls[0];
    expect(request?.body).toEqual({ username: "ana.teste", password: "segredo" });
    expect(request?.path).toBe("/auth/login");
    expect(request?.search.toString()).toBe("");
  });

  it.each([
    [401, "invalid_credentials"],
    [400, "invalid_credentials"],
    [503, "unavailable"],
    [500, "unavailable"],
  ] as const)("maps a %s login response to %s", async (status, reason) => {
    const { client } = clientWith({ "POST /auth/login": apiError(status, "internal_error", "x", { requestId: "req-1" }) });
    await expect(client.login({ username: "usuario.teste", password: "x" })).resolves.toMatchObject({ ok: false, reason, correlationId: "req-1" });
  });

  it("shows a valid Sankhya login without Force access as access_not_configured (403 with that exact code)", async () => {
    const { client } = clientWith({ "POST /auth/login": apiError(403, "access_not_configured", "x", { requestId: "req-1" }) });
    await expect(client.login({ username: "usuario.teste", password: "x" })).resolves.toMatchObject({
      ok: false,
      reason: "access_not_configured",
      correlationId: "req-1",
    });
  });

  it("never reports a CORS/origin rejection (403 forbidden) as a channel restriction", async () => {
    const { client } = clientWith({ "POST /auth/login": apiError(403, "forbidden", "x", { requestId: "req-1" }) });
    const result = await client.login({ username: "usuario.teste", password: "x" });
    expect(result).toMatchObject({ ok: false, reason: "unavailable", correlationId: "req-1" });
    expect(result).not.toMatchObject({ reason: "channel_forbidden" });
  });

  it("maps 429 to rate_limited with the Retry-After seconds", async () => {
    const { client } = clientWith({ "POST /auth/login": apiError(429, "rate_limited", "x", { headers: { "retry-after": "90" } }) });
    await expect(client.login({ username: "usuario.teste", password: "x" })).resolves.toMatchObject({
      ok: false,
      reason: "rate_limited",
      retryAfterSeconds: 90,
    });
  });

  it("maps a network failure to unavailable", async () => {
    const client = createApiAuthClient(createWebApiClient({ origin: "http://localhost", fetch: () => Promise.reject(new Error("offline")) }));
    await expect(client.login({ username: "usuario.teste", password: "x" })).resolves.toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("treats a 401 on logout as already signed out but surfaces other failures", async () => {
    await expect(clientWith({ "POST /auth/logout": apiError(401, "unauthenticated", "x") }).client.logout()).resolves.toBeUndefined();
    await expect(clientWith({ "POST /auth/logout": apiError(503, "service_unavailable", "x") }).client.logout()).rejects.toMatchObject({
      status: 503,
    });
  });
});

describe("browser storage", () => {
  it("never writes session or token data to web storage or cookies", async () => {
    const before = { local: localStorage.length, session: sessionStorage.length, cookie: document.cookie };
    const { client } = clientWith({ "POST /auth/login": session(true), "GET /auth/session": session(true) });
    await client.login({ username: "ana.teste", password: "segredo" });
    await client.getSession();
    expect({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }).toEqual(before);
  });
});
