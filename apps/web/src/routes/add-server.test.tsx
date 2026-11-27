import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebApiClient } from "../lib/api";
import { SERVER_CODE_HEADER, serverKeyOf } from "../lib/server-code";
import { apiError, createMockApi, renderApp } from "../test/harness";
import { makeServerCode, TEST_SERVER_KEY } from "../test/server-code";

const GOOD_KEY = "B".repeat(43);

afterEach(() => vi.unstubAllGlobals());

/** The guarded check route, answered by `fetch` itself (it is not part of the generated client). */
function stubCheck(accepted: (key: string | null) => boolean) {
  const fetchStub = vi.fn(async (_url: unknown, init?: { headers?: Record<string, string> }) => {
    const key = init?.headers?.[SERVER_CODE_HEADER] ?? null;
    return new Response(null, { status: accepted(key) ? 204 : 401 });
  });
  vi.stubGlobal("fetch", fetchStub);
  return fetchStub;
}

describe("server code format", () => {
  it("reads the key of a well-formed code and rejects anything else", () => {
    expect(serverKeyOf(makeServerCode(GOOD_KEY))).toBe(GOOD_KEY);
    for (const bad of ["", "abc", "sf1.", "sf1.@@@", `sf1.${btoa("{}")}`, makeServerCode("curta")]) expect(serverKeyOf(bad)).toBeNull();
  });
});

describe("Adicionar servidor", () => {
  it("is the only screen without a stored code: no sign-in form", async () => {
    window.localStorage.clear();
    renderApp("/login", { signedIn: false });
    expect(await screen.findByRole("heading", { name: "Adicionar servidor" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Usuário")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Entrar" })).not.toBeInTheDocument();
  });

  it("answers only 'Código inválido' to a code the server refuses, and stores nothing", async () => {
    window.localStorage.clear();
    const fetchStub = stubCheck(() => false);
    const { user } = renderApp("/login", { signedIn: false });
    await user.type(await screen.findByLabelText("Código do servidor"), makeServerCode(GOOD_KEY));
    await user.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(await screen.findByText("Código inválido")).toBeInTheDocument();
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("sf.serverCode")).toBeNull();
    expect(screen.queryByRole("button", { name: "Entrar" })).not.toBeInTheDocument();
  });

  it("refuses a malformed paste without calling the server", async () => {
    window.localStorage.clear();
    const fetchStub = stubCheck(() => true);
    const { user } = renderApp("/login", { signedIn: false });
    await user.type(await screen.findByLabelText("Código do servidor"), "qualquer coisa");
    await user.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(await screen.findByText("Código inválido")).toBeInTheDocument();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("checks the key in the header, stores the accepted code and only then shows the sign-in", async () => {
    window.localStorage.clear();
    const code = makeServerCode(GOOD_KEY);
    const fetchStub = stubCheck((key) => key === GOOD_KEY);
    const { user } = renderApp("/login", { signedIn: false });
    await user.type(await screen.findByLabelText("Código do servidor"), code);
    await user.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(await screen.findByLabelText("Usuário")).toBeInTheDocument();
    expect(window.localStorage.getItem("sf.serverCode")).toBe(code);
    // Only the key travels, never the whole code.
    const [url, init] = fetchStub.mock.calls[0] ?? [];
    expect(String(url)).toContain("/server-code/check");
    expect(JSON.stringify(init)).not.toContain(code);
    expect(screen.queryByRole("heading", { name: "Adicionar servidor" })).not.toBeInTheDocument();
  });
});

describe("X-Server-Code on every API request", () => {
  it("sends the key on the session check, and nothing else of the code", async () => {
    const { calls } = renderApp("/", { role: "seller" });
    await screen.findByRole("heading", { name: "Início" });
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.headers.get(SERVER_CODE_HEADER)).toBe(TEST_SERVER_KEY);
  });

  it("drops the stored code on an empty 401 (the guard) and goes back to Adicionar servidor", async () => {
    const mock = createMockApi({});
    const api = createWebApiClient({ origin: "http://localhost", fetch: async () => new Response(null, { status: 401 }) });
    expect(window.localStorage.getItem("sf.serverCode")).not.toBeNull();
    await api.GET("/auth/session");
    expect(window.localStorage.getItem("sf.serverCode")).toBeNull();
    expect(mock.calls).toHaveLength(0);
  });

  it("keeps the code on a session 401 (it carries the error envelope)", async () => {
    const response = apiError(401, "unauthenticated", "Sessão expirada.");
    const api = createWebApiClient({
      origin: "http://localhost",
      fetch: async () => new Response(JSON.stringify(response.body), { status: 401, headers: { "content-type": "application/json" } }),
    });
    await api.GET("/auth/session");
    expect(window.localStorage.getItem("sf.serverCode")).not.toBeNull();
  });

  it("returns a signed-in browser to Adicionar servidor when the guard refuses it", async () => {
    const { queryClient } = renderApp("/", { role: "seller" });
    await screen.findByRole("heading", { name: "Início" });
    const api = createWebApiClient({ origin: "http://localhost", fetch: async () => new Response(null, { status: 401 }) });
    await api.GET("/auth/session");
    expect(await screen.findByRole("heading", { name: "Adicionar servidor" })).toBeInTheDocument();
    await waitFor(() => expect(queryClient.getQueryCache().getAll()).toHaveLength(0));
  });
});
