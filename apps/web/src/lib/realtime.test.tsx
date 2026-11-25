import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORDER_ID, orderDetail, orderItem, customerDetail, customer, customersPage, productsPage, product, pricedList } from "../test/fixtures";
import { createMockApi, renderApp } from "../test/harness";
import { createWebApiClient } from "./api";
import { createApiAuthClient } from "./api-auth-client";
import { AppServicesProvider } from "./app-context";
import { FALLBACK_POLL_MS, invalidateTopic, parsePing, requestOrderRefresh, resetRefreshCooldowns, useRealtimeSync, useRefreshOrdersInView } from "./realtime";
import { defaultRuntimeConfig } from "./runtime-config";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  private listeners = new Map<string, ((event: Event) => void)[]>();
  constructor(
    public url: string,
    public init?: EventSourceInit,
  ) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, fn: (event: Event) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  close() {
    this.closed = true;
  }
  emit(name: string, data: string) {
    for (const fn of this.listeners.get(name) ?? []) fn(new MessageEvent(name, { data }));
  }
}

const live = () => FakeEventSource.instances.filter((source) => !source.closed);

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

function wrapperFor(queryClient: QueryClient, handlers = {}) {
  const mock = createMockApi(handlers);
  const api = createWebApiClient({ fetch: mock.fetch, origin: "http://localhost" });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AppServicesProvider value={{ config: defaultRuntimeConfig, authClient: createApiAuthClient(api), api }}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </AppServicesProvider>
  );
  return { wrapper, api, calls: mock.calls };
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  resetRefreshCooldowns();
  setVisibility("visible");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("parsePing", () => {
  it("accepts only the two topics", () => {
    expect(parsePing('{"topic":"orders"}')).toBe("orders");
    expect(parsePing('{"topic":"reference"}')).toBe("reference");
    expect(parsePing('{"topic":"x"}')).toBeNull();
    expect(parsePing("nope")).toBeNull();
    expect(parsePing(undefined)).toBeNull();
  });
});

describe("useRealtimeSync", () => {
  it("opens one same-origin stream and maps each topic to its query families", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { wrapper } = wrapperFor(queryClient);
    renderHook(() => useRealtimeSync(true), { wrapper });
    expect(live()).toHaveLength(1);
    expect(live()[0]?.url).toBe("/api/v1/sync/events");

    act(() => live()[0]?.emit("ping", '{"topic":"orders"}'));
    const ordersKeys = spy.mock.calls.map((call) => (call[0]?.queryKey as string[])[0]);
    expect(ordersKeys).toEqual(expect.arrayContaining(["orders", "release-queue"]));
    expect(ordersKeys).not.toContain("customers");

    spy.mockClear();
    act(() => live()[0]?.emit("ping", '{"topic":"reference"}'));
    const referenceKeys = spy.mock.calls.map((call) => (call[0]?.queryKey as string[])[0]);
    expect(referenceKeys).toEqual(expect.arrayContaining(["customers", "products", "configuration"]));
    expect(referenceKeys).not.toContain("orders");
  });

  it("pauses while the tab is hidden and reconnects (catching up) when visible again", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { wrapper } = wrapperFor(queryClient);
    renderHook(() => useRealtimeSync(true), { wrapper });
    act(() => setVisibility("hidden"));
    expect(live()).toHaveLength(0);
    spy.mockClear();
    act(() => setVisibility("visible"));
    expect(live()).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["orders"] });
  });

  it("reconnects with backoff after an error and falls back to a 30 s orders refetch while the stream is down", () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { wrapper } = wrapperFor(queryClient);
    renderHook(() => useRealtimeSync(true), { wrapper });
    act(() => live()[0]?.onerror?.());
    expect(live()).toHaveLength(0);
    act(() => void vi.advanceTimersByTime(1_000));
    expect(live()).toHaveLength(1);
    act(() => live()[0]?.onerror?.());
    spy.mockClear();
    act(() => void vi.advanceTimersByTime(FALLBACK_POLL_MS));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["orders"] });
    // The stream comes back: the timed fallback stops.
    act(() => void vi.advanceTimersByTime(2_000));
    act(() => live()[0]?.onopen?.());
    spy.mockClear();
    act(() => void vi.advanceTimersByTime(FALLBACK_POLL_MS * 2));
    expect(spy).not.toHaveBeenCalled();
  });

  it("closes the stream on unmount", () => {
    const queryClient = new QueryClient();
    const { wrapper } = wrapperFor(queryClient);
    const { unmount } = renderHook(() => useRealtimeSync(true), { wrapper });
    unmount();
    expect(live()).toHaveLength(0);
  });
});

describe("requestOrderRefresh", () => {
  const ids = Array.from({ length: 25 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);

  it("asks for at most 20 orders and honours the 10 s cooldown per id", async () => {
    const queryClient = new QueryClient();
    const { api, calls } = wrapperFor(queryClient, { "POST /orders/:id/refresh": { status: 202, body: { accepted: true } } });
    await requestOrderRefresh(api, queryClient, ids, 1_000);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(20);
    await requestOrderRefresh(api, queryClient, ids.slice(0, 5), 5_000);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(20);
    await requestOrderRefresh(api, queryClient, ids.slice(0, 5), 11_500);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(25);
  });
});

describe("useRefreshOrdersInView", () => {
  it("refreshes once when the orders first appear and again when the tab returns (after the cooldown)", async () => {
    const queryClient = new QueryClient();
    const { wrapper, calls } = wrapperFor(queryClient, { "POST /orders/:id/refresh": { status: 202, body: { accepted: true } } });
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000);
    const { rerender } = renderHook(({ ids }: { ids: string[] }) => useRefreshOrdersInView(ids), { wrapper, initialProps: { ids: [] as string[] } });
    expect(calls).toHaveLength(0);
    rerender({ ids: [ORDER_ID] });
    await waitFor(() => expect(calls.filter((call) => call.method === "POST")).toHaveLength(1));
    nowSpy.mockReturnValue(20_000);
    act(() => setVisibility("hidden"));
    act(() => setVisibility("visible"));
    await waitFor(() => expect(calls.filter((call) => call.method === "POST")).toHaveLength(2));
    nowSpy.mockRestore();
  });
});

describe("invalidateTopic", () => {
  it("never touches queries outside the topic", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    invalidateTopic(queryClient, "orders");
    expect(spy.mock.calls.some((call) => (call[0]?.queryKey as string[])[0] === "customers")).toBe(false);
  });
});

describe("automatic updates keep what the user is typing", () => {
  it("an open draft keeps the typed quantity when a ping brings a newer server version", async () => {
    let version = 1;
    const items = () => [orderItem()];
    const { user, queryClient } = renderApp(`/pedidos/${ORDER_ID}`, {
      handlers: {
        "GET /orders/:id": () => ({ body: orderDetail({ version, items: items() }) }),
        "POST /orders/:id/refresh": { status: 202, body: { accepted: true } },
        "GET /products": { body: productsPage([product({ code: 2001, description: "Balão", listPrice: pricedList("12.5") })]) },
        "GET /customers/:code": { body: customerDetail() },
        "GET /customers": { body: customersPage([customer()]) },
      },
    });
    const field = await screen.findByLabelText(/^Quantidade de /);
    await user.clear(field);
    await user.type(field, "7");
    expect(field).toHaveValue("7");
    version = 2;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["orders"] });
    });
    await waitFor(() => expect(queryClient.getQueryData<{ version: number }>(["orders", "detail", ORDER_ID])?.version).toBe(2));
    expect(screen.getByLabelText(/^Quantidade de /)).toHaveValue("7");
  });

  it("an order deleted in Sankhya (404) shows the plain not-found state without a retry button", async () => {
    const { queryClient } = renderApp(`/pedidos/${ORDER_ID}`, {
      handlers: {
        "GET /orders/:id": { status: 404, body: { code: "not_found", message: "x" } },
        "GET /products": { body: productsPage([]) },
      },
    });
    expect(await screen.findByText("Não encontrado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Tentar de novo/ })).not.toBeInTheDocument();
    expect(queryClient).toBeDefined();
  });
});

