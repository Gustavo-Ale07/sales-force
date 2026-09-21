import { API_BASE_PATH as CONTRACT_BASE_PATH } from "@salesforce/contracts";
import { describe, expect, it } from "vitest";
import { apiError, createMockApi } from "../test/harness";
import { API_BASE_PATH, ApiRequestError, callApi, createWebApiClient, toApiRequestError } from "./api";
import { describeApiError } from "./error-message";

describe("API client", () => {
  it("uses the same base path as the contract (no drift from the duplicated constant)", () => {
    expect(API_BASE_PATH).toBe(CONTRACT_BASE_PATH);
  });

  it("calls only the same origin under /api/v1, same-origin credentials, no Authorization header", async () => {
    const mock = createMockApi({ "GET /ready": { body: { status: "ready" } } });
    let seen: Request | undefined;
    const api = createWebApiClient({
      origin: "http://localhost",
      fetch: (request) => {
        seen = request;
        return mock.fetch(request);
      },
    });
    await api.GET("/ready");
    expect(seen?.url).toBe("http://localhost/api/v1/ready");
    expect(seen?.credentials).toBe("same-origin");
    expect(seen?.headers.get("authorization")).toBeNull();
  });

  it("turns the error envelope into an ApiRequestError with the correlation id", () => {
    const response = new Response(null, { status: 409, headers: { "x-request-id": "req-1" } });
    const error = toApiRequestError(response, {
      code: "version_conflict",
      message: "Versão desatualizada",
      details: { issues: [{ path: "items[0]", code: "x" }] },
    });
    expect(error).toMatchObject({ status: 409, code: "version_conflict", correlationId: "req-1" });
    expect(error.issues).toEqual([{ path: "items[0]", code: "x", message: undefined }]);
  });

  it("falls back to details.requestId and reads Retry-After from the header", () => {
    const response = new Response(null, { status: 429, headers: { "retry-after": "30" } });
    const error = toApiRequestError(response, { code: "rate_limited", message: "x", details: { requestId: "req-2" } });
    expect(error.correlationId).toBe("req-2");
    expect(error.retryAfterSeconds).toBe(30);
  });

  it("reports a network failure as status 0", async () => {
    await expect(callApi(() => Promise.reject(new Error("offline")))).rejects.toMatchObject({ status: 0 });
    expect(new ApiRequestError({ status: 0, message: "x" }).isNetwork).toBe(true);
  });
});

describe("describeApiError", () => {
  const request = async (status: number) => {
    const mock = createMockApi({ "GET /ready": apiError(status, "internal_error", "Mensagem do servidor", { requestId: "req-9" }) });
    const api = createWebApiClient({ origin: "http://localhost", fetch: mock.fetch });
    return callApi(() => api.GET("/ready")).catch((error: unknown) => error);
  };

  it.each([
    [401, "Sessão expirada"],
    [403, "Sem permissão"],
    [404, "Não encontrado"],
    [429, "Muitas requisições"],
    [503, "Serviço indisponível"],
  ])("maps %s to %s and keeps the correlation id", async (status, title) => {
    const description = describeApiError(await request(status));
    expect(description.title).toBe(title);
    expect(description.correlationId).toBe("req-9");
  });

  it("shows the user-safe server message for actionable client errors", async () => {
    expect(describeApiError(await request(422)).description).toBe("Mensagem do servidor");
  });

  it("hides server internals on 5xx", async () => {
    expect(describeApiError(await request(500)).description).not.toContain("Mensagem do servidor");
  });

  it("describes a network failure", () => {
    expect(describeApiError(new ApiRequestError({ status: 0, message: "x" })).title).toBe("Sem conexão com o servidor");
  });
});
