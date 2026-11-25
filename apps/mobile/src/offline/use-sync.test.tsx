import { act, renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";
import type { SyncManager, SyncStatus } from "@salesforce/mobile-db";
import type { ConnectivityState } from "../connectivity/connectivity";
import { useSyncStatus } from "./use-sync";

const idle: SyncStatus = { phase: "idle", pending: 0, needsAttention: 0, lastSyncedAt: null, lastError: null };

function fakeSync() {
  const sync = jest.fn(async () => idle);
  const manager: SyncManager = { sync, getStatus: () => idle, subscribe: () => () => undefined, refresh: async () => idle };
  return { manager, sync };
}

describe("work that stays pending after a run never re-triggers a run (blinking loop 2026-11-24)", () => {
  beforeEach(() => {
    jest.spyOn(AppState, "addEventListener").mockImplementation((() => ({ remove: () => undefined })) as never);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  /** A manager whose run publishes syncing then idle with the SAME pending count, like a refused or backed-off order. */
  function stuckManager(pending: number) {
    let status: SyncStatus = { ...idle, pending };
    const listeners = new Set<(s: SyncStatus) => void>();
    const publish = (next: SyncStatus) => {
      status = next;
      listeners.forEach((l) => l(next));
    };
    const sync = jest.fn(async () => {
      publish({ ...status, phase: "syncing" });
      publish({ ...status, phase: "idle" });
      return status;
    });
    const manager: SyncManager = {
      sync,
      getStatus: () => status,
      subscribe: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      refresh: async () => status,
    };
    return { manager, sync };
  }

  it("a run that leaves the same work pending does not start another run, however long the clock runs", async () => {
    jest.useFakeTimers();
    const { manager, sync } = stuckManager(1);
    await renderHook(() => useSyncStatus(manager, "online"));
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    const afterStart = sync.mock.calls.filter((call: unknown[]) => call[0] === "after_save").length;
    expect(afterStart).toBeLessThanOrEqual(1);
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(sync.mock.calls.filter((call: unknown[]) => call[0] === "after_save").length).toBe(afterStart);
  });
});

describe("reference data syncs only at login and when the seller asks", () => {
  beforeEach(() => {
    jest.spyOn(AppState, "addEventListener").mockImplementation((() => ({ remove: () => undefined })) as never);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("a real login (login screen) runs ONE full sync", async () => {
    const { manager, sync } = fakeSync();
    await renderHook(() => useSyncStatus(manager, "online", true));
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith("login");
  });

  it("reopening the app with a valid session is NOT a login: it only pushes pending work", async () => {
    const { manager, sync } = fakeSync();
    await renderHook(() => useSyncStatus(manager, "online"));
    expect(sync).not.toHaveBeenCalledWith("login");
    expect(sync.mock.calls.every((call: unknown[]) => (call[1] as { pull?: boolean } | undefined)?.pull === false)).toBe(true);
  });

  it("mounted offline: nothing runs; a real login syncs fully the first time it is online", async () => {
    const { manager, sync } = fakeSync();
    const { rerender } = await renderHook((state: ConnectivityState) => useSyncStatus(manager, state, true), { initialProps: "offline" as ConnectivityState });
    expect(sync).not.toHaveBeenCalled();
    await rerender("online");
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith("login");
  });

  it("a reopened session coming online later still never downloads the base", async () => {
    const { manager, sync } = fakeSync();
    const { rerender } = await renderHook((state: ConnectivityState) => useSyncStatus(manager, state), { initialProps: "offline" as ConnectivityState });
    await rerender("online");
    expect(sync).not.toHaveBeenCalledWith("login");
    expect(sync.mock.calls.every((call: unknown[]) => (call[1] as { pull?: boolean } | undefined)?.pull === false)).toBe(true);
  });

  it("reconnecting later only pushes pending work, it never downloads the base", async () => {
    const { manager, sync } = fakeSync();
    const { rerender } = await renderHook((state: ConnectivityState) => useSyncStatus(manager, state), { initialProps: "online" as ConnectivityState });
    sync.mockClear();
    await rerender("offline");
    await rerender("online");
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith("reconnected", { pull: false });
  });

  it("returning to the foreground only pushes", async () => {
    const { manager, sync } = fakeSync();
    let listener: ((state: string) => void) | undefined;
    const spy = jest.spyOn(AppState, "addEventListener").mockImplementation(((_: string, cb: (state: string) => void) => {
      listener = cb;
      return { remove: () => undefined };
    }) as never);
    await renderHook(() => useSyncStatus(manager, "online"));
    sync.mockClear();
    await act(async () => listener?.("active"));
    expect(sync).toHaveBeenCalledWith("foreground", { pull: false });
    spy.mockRestore();
  });

  it("the slow timer only pushes (no periodic download)", async () => {
    jest.useFakeTimers();
    const { manager, sync } = fakeSync();
    await renderHook(() => useSyncStatus(manager, "online"));
    sync.mockClear();
    await act(async () => {
      jest.advanceTimersByTime(61_000);
    });
    expect(sync).toHaveBeenCalledWith("timer", { pull: false });
    expect(sync.mock.calls.every((call: unknown[]) => (call[1] as { pull?: boolean } | undefined)?.pull === false)).toBe(true);
    jest.useRealTimers();
  });
});

describe("automatic updates while online (RT-1)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function liveManager() {
    const backgroundRefresh = jest.fn(async (_what: unknown) => undefined);
    const manager: SyncManager = { sync: jest.fn(async () => idle), getStatus: () => idle, subscribe: () => () => undefined, refresh: async () => idle, backgroundRefresh };
    return { manager, backgroundRefresh };
  }

  it("a ping refreshes orders or the reference data; without a stream the foreground timers do it (30 s / 5 min)", async () => {
    jest.useFakeTimers();
    jest.spyOn(AppState, "addEventListener").mockImplementation((() => ({ remove: () => undefined })) as never);
    const { manager, backgroundRefresh } = liveManager();
    let onTopic: ((topic: "orders" | "reference") => void) | undefined;
    let onConnection: ((connected: boolean) => void) | undefined;
    const events = jest.fn((topicHandler: (topic: "orders" | "reference") => void, connectionHandler: (connected: boolean) => void) => {
      onTopic = topicHandler;
      onConnection = connectionHandler;
      return () => undefined;
    });
    await renderHook(() => useSyncStatus(manager, "online", false, events));
    backgroundRefresh.mockClear();
    await act(async () => onTopic?.("orders"));
    expect(backgroundRefresh).toHaveBeenLastCalledWith({ orders: true });
    await act(async () => onTopic?.("reference"));
    expect(backgroundRefresh).toHaveBeenLastCalledWith({ reference: true });

    // Stream connected: the timers stay quiet.
    await act(async () => onConnection?.(true));
    backgroundRefresh.mockClear();
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(backgroundRefresh).not.toHaveBeenCalled();

    // Stream lost: the fallback timers take over.
    await act(async () => onConnection?.(false));
    backgroundRefresh.mockClear();
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(backgroundRefresh).toHaveBeenCalledWith({ orders: true });
    await act(async () => {
      jest.advanceTimersByTime(270_000);
    });
    expect(backgroundRefresh).toHaveBeenCalledWith({ reference: true });
  });

  it("offline nothing runs, and the stream is not opened", async () => {
    jest.spyOn(AppState, "addEventListener").mockImplementation((() => ({ remove: () => undefined })) as never);
    const { manager, backgroundRefresh } = liveManager();
    const events = jest.fn(() => () => undefined);
    await renderHook(() => useSyncStatus(manager, "offline", false, events));
    expect(backgroundRefresh).not.toHaveBeenCalled();
    expect(events).not.toHaveBeenCalled();
  });
});
