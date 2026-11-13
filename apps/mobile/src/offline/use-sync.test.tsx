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

describe("reference data syncs only at login and when the seller asks", () => {
  beforeEach(() => {
    jest.spyOn(AppState, "addEventListener").mockImplementation((() => ({ remove: () => undefined })) as never);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("the first online mount runs ONE full sync (login)", async () => {
    const { manager, sync } = fakeSync();
    await renderHook(() => useSyncStatus(manager, "online"));
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith("login");
  });

  it("mounted offline: nothing runs; the first time it is online it is the login sync", async () => {
    const { manager, sync } = fakeSync();
    const { rerender } = await renderHook((state: ConnectivityState) => useSyncStatus(manager, state), { initialProps: "offline" as ConnectivityState });
    expect(sync).not.toHaveBeenCalled();
    await rerender("online");
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith("login");
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
