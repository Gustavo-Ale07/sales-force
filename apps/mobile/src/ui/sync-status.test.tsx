import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import type { SyncStatus } from "@salesforce/mobile-db";
import { colors } from "../theme";
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

describe("SyncPanel on-demand sync", () => {
  it("Conexão line equals the Situação verification", async () => {
    const status: SyncStatus = { ...idle, phase: "offline", failure: "server_unavailable", lastError: "x" };
    await render(<SyncPanel status={status} connectivity="online" onSyncNow={noop} />);
    expect(screen.getByText("Servidor do Force indisponível — alterações salvas neste aparelho, tentaremos de novo")).toBeTruthy();
    expect(screen.getByText("Internet: ok · Servidor: sem resposta")).toBeTruthy();
  });

  it("shows the step being run while syncing, and keeps a single 'Sincronizar agora' button", async () => {
    const onSyncNow = jest.fn();
    await render(<SyncPanel status={{ ...idle, phase: "syncing", progress: { label: "Atualizando preços", percent: 40 } }} connectivity="online" onSyncNow={onSyncNow} />);
    expect(screen.getByText("Atualizando preços (40%)")).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("lists the orders in attention with the reason, and names the failed steps when Sankhya is down", async () => {
    const status: SyncStatus = {
      ...idle,
      needsAttention: 1,
      failure: "sankhya_unavailable",
      failedSteps: ["Preços"],
      attention: [{ localId: "a", customerName: "Cliente X", reason: "O cliente está bloqueado." }],
    };
    await render(<SyncPanel status={status} connectivity="online" onSyncNow={noop} />);
    expect(screen.getByText("Cliente X")).toBeTruthy();
    expect(screen.getByText("O cliente está bloqueado.")).toBeTruthy();
    expect(screen.getByText("Não atualizado: Preços")).toBeTruthy();
  });

  it("pressing the button runs the sync", async () => {
    const onSyncNow = jest.fn();
    await render(<SyncPanel status={idle} connectivity="online" onSyncNow={onSyncNow} />);
    await fireEvent.press(screen.getByRole("button", { name: "Sincronizar agora" }));
    expect(onSyncNow).toHaveBeenCalledTimes(1);
  });
});

describe("SyncPanel age of the data", () => {
  const now = new Date("2026-11-13T18:00:00.000Z").getTime();
  const ago = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
  const colorOf = (text: string) => (StyleSheet.flatten(screen.getByText(text).props.style) as { color?: string }).color;

  it("shows how old the last successful sync is, in the normal colour within 24 h", async () => {
    await render(<SyncPanel status={{ ...idle, lastSyncedAt: ago(3) }} connectivity="online" onSyncNow={noop} now={now} />);
    expect(screen.getByText("Dados atualizados")).toBeTruthy();
    expect(screen.getByText("há 3 h")).toBeTruthy();
    expect(colorOf("há 3 h")).not.toBe(colors.warning);
  });

  it("turns amber after 24 h and does not sync by itself", async () => {
    const onSyncNow = jest.fn();
    await render(<SyncPanel status={{ ...idle, lastSyncedAt: ago(50) }} connectivity="online" onSyncNow={onSyncNow} now={now} />);
    expect(screen.getByText("há 2 dias")).toBeTruthy();
    expect(colorOf("há 2 dias")).toBe(colors.warning);
    expect(onSyncNow).not.toHaveBeenCalled();
  });

  it("shows no age line when the device never synced", async () => {
    await render(<SyncPanel status={idle} connectivity="online" onSyncNow={noop} now={now} />);
    expect(screen.queryByText("Dados atualizados")).toBeNull();
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
