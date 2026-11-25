import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { createWebApiClient } from "./api";
import { createApiAuthClient } from "./api-auth-client";
import { AppServicesProvider } from "./app-context";
import { defaultRuntimeConfig } from "./runtime-config";
import { useUpdateCustomer } from "./use-customer-write";
import { emptyEditForm } from "./customer-form";
import { apiError, createMockApi, type Handlers } from "../test/harness";

function setup(handlers: Handlers) {
  const mock = createMockApi(handlers);
  const api = createWebApiClient({ fetch: mock.fetch, origin: "http://localhost" });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AppServicesProvider value={{ config: defaultRuntimeConfig, authClient: createApiAuthClient(api), api }}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </AppServicesProvider>
  );
  return { ...renderHook(() => useUpdateCustomer(1001), { wrapper }), calls: mock.calls };
}

const idOf = (call: { body: unknown } | undefined) => (call?.body as { clientRequestId: string }).clientRequestId;

describe("useUpdateCustomer", () => {
  it("keeps the request id after a lost response and drops it after a definitive refusal", async () => {
    let attempt = 0;
    const { result, calls } = setup({
      "PATCH /customers/:code": () => {
        attempt += 1;
        return attempt === 1 ? apiError(503, "unavailable", "x") : apiError(409, "conflict", "x", { details: { reason: "customer_edit_disabled" } });
      },
    });
    const form = { ...emptyEditForm(), phone: "1133334444" };
    await act(async () => void (await result.current.mutateAsync(form).catch(() => undefined)));
    await act(async () => void (await result.current.mutateAsync(form).catch(() => undefined)));
    await act(async () => void (await result.current.mutateAsync(form).catch(() => undefined)));
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(idOf(calls[0])).toBe(idOf(calls[1]));
    expect(idOf(calls[2])).not.toBe(idOf(calls[1]));
  });

  it("uses a new request id when the form changed", async () => {
    const { result, calls } = setup({ "PATCH /customers/:code": apiError(503, "unavailable", "x") });
    await act(async () => void (await result.current.mutateAsync({ ...emptyEditForm(), phone: "1133334444" }).catch(() => undefined)));
    await act(async () => void (await result.current.mutateAsync({ ...emptyEditForm(), phone: "1133335555" }).catch(() => undefined)));
    expect(idOf(calls[0])).not.toBe(idOf(calls[1]));
  });
});
