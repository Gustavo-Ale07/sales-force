import { render, screen, within } from "@testing-library/react-native";
import { AccessibilityInfo, StyleSheet } from "react-native";
import type { SyncStatus } from "@salesforce/mobile-db";
import { describeSyncChip } from "../offline/sync-status-text";
import { SyncStatusChip } from "./sync-status";
import { SyncIcon } from "./sync-icon";
import { colors } from "../theme";

const idle: SyncStatus = { phase: "idle", pending: 0, needsAttention: 0, lastSyncedAt: null, lastError: null };
const noop = () => undefined;

describe("describeSyncChip wording", () => {
  const now = Date.parse("2026-11-12T12:00:00.000Z");
  it("says Sincronizando… while syncing", () => {
    expect(describeSyncChip({ ...idle, phase: "syncing" }, "online", now)).toEqual({ text: "Sincronizando…", tone: "busy" });
  });
  it("says Atualizado agora right after a sync and Sincronizado later", () => {
    expect(describeSyncChip({ ...idle, lastSyncedAt: "2026-11-12T11:59:40.000Z" }, "online", now).text).toBe("Atualizado agora");
    expect(describeSyncChip({ ...idle, lastSyncedAt: "2026-11-12T11:50:00.000Z" }, "online", now).text).toBe("Sincronizado");
  });
  it("says Falhou. Tentar de novo when the sync failed", () => {
    expect(describeSyncChip({ ...idle, phase: "error", lastError: "x" }, "online", now)).toEqual({ text: "Falhou. Tentar de novo", tone: "error" });
  });
});

describe("SyncIcon", () => {
  afterEach(() => jest.restoreAllMocks());

  it("spins while syncing, and is a static check / alert otherwise", async () => {
    await render(<SyncIcon tone="busy" syncing color="#000" />);
    expect(screen.getByTestId("sync-icon-spinner", { includeHiddenElements: true })).toBeTruthy();
    await render(<SyncIcon tone="ok" syncing={false} color="#000" />);
    expect(screen.getByTestId("sync-icon-ok", { includeHiddenElements: true })).toBeTruthy();
    await render(<SyncIcon tone="error" syncing={false} color="#000" />);
    expect(screen.getByTestId("sync-icon-error", { includeHiddenElements: true })).toBeTruthy();
  });

  it("does not animate when the system asks to reduce motion (ring stays unrotated)", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    await render(<SyncIcon tone="busy" syncing color="#000" />);
    const style = screen.getByTestId("sync-icon-spinner", { includeHiddenElements: true }).props.style as unknown;
    expect(JSON.stringify(style)).toContain("0deg");
  });

  it("the header indicator shows the spinner while syncing and NO text", async () => {
    await render(<SyncStatusChip status={{ ...idle, phase: "syncing" }} connectivity="online" onPress={noop} />);
    expect(screen.getByTestId("sync-icon-spinner", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText("Sincronizando…")).toBeNull();
    expect(screen.getByRole("button", { name: "Status de sincronização: Sincronizando…" })).toBeTruthy();
  });

  const shapes: Array<[string, SyncStatus, string]> = [
      ["sync-mark-ok", { ...idle, lastSyncedAt: "2026-01-01T10:00:00.000Z" }, "Sincronizado"],
      ["sync-mark-busy", { ...idle, phase: "syncing" }, "Sincronizando…"],
      ["sync-mark-count", { ...idle, pending: 3 }, "Pendências (3)"],
      ["sync-mark-error", { ...idle, phase: "error", lastError: "x" }, "Falhou. Tentar de novo"],
  ];
  it.each(shapes)("%s: own SHAPE, an accessibility label and no visible word (never color alone)", async (testID, status, label) => {
    await render(<SyncStatusChip status={status} connectivity="online" onPress={noop} />);
    expect(screen.getByTestId(testID)).toBeTruthy();
    expect(screen.getByRole("button", { name: `Status de sincronização: ${label}` })).toBeTruthy();
    expect(screen.queryByText(label)).toBeNull();
  });

  it("offline has its own hollow-ring mark, distinct from the others", async () => {
    await render(<SyncStatusChip status={idle} connectivity="offline" onPress={noop} />);
    expect(screen.getByTestId("sync-mark-offline")).toBeTruthy();
    expect(screen.getByTestId("sync-arrows", { includeHiddenElements: true })).toBeTruthy();
  });

  it("is white arrows on the navy header (no white box) in a 44 px touch target", async () => {
    await render(<SyncStatusChip status={idle} connectivity="online" onPress={noop} />);
    const button = screen.getByRole("button", { name: /Status de sincronização/ });
    const flat = StyleSheet.flatten(button.props.style as never) as { minWidth: number; minHeight: number; backgroundColor?: string };
    expect(flat.minWidth).toBeGreaterThanOrEqual(44);
    expect(flat.minHeight).toBeGreaterThanOrEqual(44);
    expect(flat.backgroundColor).toBeUndefined();
    expect(JSON.stringify(screen.toJSON())).toContain(colors.onNavy);
  });

  const centred: Array<[string, SyncStatus, "online" | "offline", string]> = [
    ["ok", { ...idle, lastSyncedAt: "2026-01-01T10:00:00.000Z" }, "online", "sync-mark-ok"],
    ["syncing", { ...idle, phase: "syncing" }, "online", "sync-mark-busy"],
    ["attention", { ...idle, phase: "error", lastError: "x" }, "online", "sync-mark-error"],
    ["pending", { ...idle, pending: 3 }, "online", "sync-mark-count"],
    ["offline", idle, "offline", "sync-mark-offline"],
  ];
  it.each(centred)("%s: the mark is centred between the arrows, small, and not inside the spinning arrows", async (_name, status, connectivity, testID) => {
    await render(<SyncStatusChip status={status} connectivity={connectivity} onPress={noop} />);
    const anchor = StyleSheet.flatten(screen.getByTestId("sync-mark-anchor").props.style as never) as Record<string, unknown>;
    expect(anchor).toMatchObject({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" });
    const mark = StyleSheet.flatten(screen.getByTestId(testID).props.style as never) as Record<string, unknown>;
    expect(mark.position).toBeUndefined();
    expect(mark.right).toBeUndefined();
    expect(mark.bottom).toBeUndefined();
    expect(Number(mark.height ?? 0)).toBeLessThanOrEqual(12);
    // The spinner is a sibling, never an ancestor of the mark.
    const spinner = screen.getByTestId(status.phase === "syncing" ? "sync-icon-spinner" : "sync-arrows", { includeHiddenElements: true });
    expect(within(spinner).queryByTestId(testID, { includeHiddenElements: true })).toBeNull();
    expect(within(spinner).queryByTestId("sync-mark-anchor", { includeHiddenElements: true })).toBeNull();
  });

  it("the amber mark carries the count of waiting changes (9+ when large)", async () => {
    await render(<SyncStatusChip status={{ ...idle, pending: 12 }} connectivity="online" onPress={noop} />);
    expect(screen.getByText("9+")).toBeTruthy();
  });
});
