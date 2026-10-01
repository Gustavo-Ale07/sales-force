import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import type { SyncStatus } from "@salesforce/mobile-db";
import { HeaderSyncStatus, SyncPanel, SyncStatusChip } from "./sync-status";

const idle: SyncStatus = { phase: "idle", pending: 0, needsAttention: 0, lastSyncedAt: null, lastError: null };
const noop = () => undefined;

describe("SyncPanel quarantine entry", () => {
  it("shows the retained-orders link with the count when there are retained orders", async () => {
    const onOpenQuarantine = jest.fn();
    await render(<SyncPanel status={{ ...idle, needsAttention: 2 }} connectivity="online" onSyncNow={noop} quarantinedCount={2} onOpenQuarantine={onOpenQuarantine} />);
    await fireEvent.press(screen.getByRole("button", { name: "Ver pedidos antigos retidos" }));
    expect(onOpenQuarantine).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Pedidos antigos retidos (2)")).toBeTruthy();
    expect(screen.getByText(/não são enviados ao Force/)).toBeTruthy();
  });

  it("hides the link when nothing is retained or no handler is given", async () => {
    await render(<SyncPanel status={idle} connectivity="online" onSyncNow={noop} quarantinedCount={0} onOpenQuarantine={noop} />);
    expect(screen.queryByRole("button", { name: "Ver pedidos antigos retidos" })).toBeNull();
    await render(<SyncPanel status={idle} connectivity="online" onSyncNow={noop} quarantinedCount={3} />);
    expect(screen.queryByRole("button", { name: "Ver pedidos antigos retidos" })).toBeNull();
  });
});

describe("header sync status", () => {
  it("closing the sheet and opening the retained orders happen together", async () => {
    const onOpenQuarantine = jest.fn();
    await render(<HeaderSyncStatus status={{ ...idle, needsAttention: 1 }} connectivity="online" onSyncNow={noop} quarantinedCount={1} onOpenQuarantine={onOpenQuarantine} />);
    await fireEvent.press(screen.getByRole("button", { name: /Status de sincronização/ }));
    await fireEvent.press(await screen.findByRole("button", { name: "Ver pedidos antigos retidos" }));
    expect(onOpenQuarantine).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Ver pedidos antigos retidos" })).toBeNull();
  });

  it("the chip is at least 44 points tall (touch target)", async () => {
    await render(<SyncStatusChip status={idle} connectivity="online" onPress={noop} />);
    const style = StyleSheet.flatten(screen.getByRole("button", { name: /Status de sincronização/ }).props.style) as { minHeight?: number };
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
  });
});
