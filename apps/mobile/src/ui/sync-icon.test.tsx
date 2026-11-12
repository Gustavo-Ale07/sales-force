import { render, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import type { SyncStatus } from "@salesforce/mobile-db";
import { describeSyncChip } from "../offline/sync-status-text";
import { SyncStatusChip } from "./sync-status";
import { SyncIcon } from "./sync-icon";

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

  it("the header chip shows the spinner while syncing", async () => {
    await render(<SyncStatusChip status={{ ...idle, phase: "syncing" }} connectivity="online" onPress={noop} />);
    expect(screen.getByTestId("sync-icon-spinner", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText("Sincronizando…")).toBeTruthy();
  });
});
