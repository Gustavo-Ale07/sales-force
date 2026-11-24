import { fireEvent, render, screen } from "@testing-library/react-native";
import { withModal } from "../test-render";
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
    await render(withModal(<HeaderSyncStatus status={{ ...idle, phase: "error", needsAttention: 1 }} connectivity="online" onSyncNow={noop} quarantinedCount={1} onOpenQuarantine={onOpenQuarantine} />));
    await fireEvent.press(screen.getByRole("button", { name: /Status de sincronização/ }));
    await fireEvent.press(await screen.findByRole("button", { name: "Ver detalhes" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Ver pedidos antigos retidos" }));
    expect(onOpenQuarantine).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Ver pedidos antigos retidos" })).toBeNull();
  });

  it("the indicator is at least 44 x 44 points (touch target)", async () => {
    await render(<SyncStatusChip status={idle} connectivity="online" onPress={noop} />);
    const style = StyleSheet.flatten(screen.getByRole("button", { name: /Status de sincronização/ }).props.style) as { minHeight?: number; minWidth?: number };
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
  });

  it("a short tap on a healthy dot syncs right away", async () => {
    const onSyncNow = jest.fn();
    await render(withModal(<HeaderSyncStatus status={idle} connectivity="online" onSyncNow={onSyncNow} />));
    await fireEvent.press(screen.getByRole("button", { name: /Status de sincronização/ }));
    expect(onSyncNow).toHaveBeenCalledTimes(1);
  });

  it("a short tap while syncing does nothing", async () => {
    const onSyncNow = jest.fn();
    await render(withModal(<HeaderSyncStatus status={{ ...idle, phase: "syncing" }} connectivity="online" onSyncNow={onSyncNow} />));
    await fireEvent.press(screen.getByRole("button", { name: /Status de sincronização/ }));
    expect(onSyncNow).not.toHaveBeenCalled();
  });

  it("long press opens the standard popup 'Última sincronização às HH:MM' with 'Sincronizar agora'", async () => {
    const onSyncNow = jest.fn();
    const at = new Date(2026, 10, 23, 10, 41).toISOString();
    await render(withModal(<HeaderSyncStatus status={{ ...idle, lastSyncedAt: at }} connectivity="online" onSyncNow={onSyncNow} />));
    await fireEvent(screen.getByRole("button", { name: /Status de sincronização/ }), "longPress");
    expect(await screen.findByText("Última sincronização às 10:41")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ver detalhes" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Sincronizar agora" }));
    expect(onSyncNow).toHaveBeenCalledTimes(1);
  });

  it("on failure the popup gives the reason in seller language, 'Ver detalhes' and 'Tentar de novo'", async () => {
    const onSyncNow = jest.fn();
    await render(withModal(<HeaderSyncStatus status={{ ...idle, phase: "error", lastError: "x" }} connectivity="online" onSyncNow={onSyncNow} />));
    await fireEvent.press(screen.getByRole("button", { name: /Status de sincronização/ }));
    expect(await screen.findByText("Erro ao sincronizar")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ver detalhes" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(onSyncNow).toHaveBeenCalledTimes(1);
  });
});

describe("SyncPanel mobility detail (owner 2026-11-13)", () => {
  const mobility = [
    { kind: "products" as const, visible: 90, hidden: 10, keptPrevious: false },
    { kind: "tops" as const, visible: 2, hidden: 1, keptPrevious: false },
  ];

  it("shows visible/hidden counts per kind when the server sent them (staff detail view)", async () => {
    await render(<SyncPanel status={{ ...idle, mobility }} connectivity="online" onSyncNow={noop} />);
    expect(screen.getByText("Produtos: 90 visíveis, 10 ocultos")).toBeTruthy();
    expect(screen.getByText("Tipos de operação: 2 visíveis, 1 oculto")).toBeTruthy();
    expect(screen.queryByText(/Configuração de mobilidade incompleta/)).toBeNull();
  });

  it("warns when the server kept the previous base", async () => {
    await render(<SyncPanel status={{ ...idle, mobility: [{ kind: "negotiationTypes", visible: 3, hidden: 0, keptPrevious: true }] }} connectivity="online" onSyncNow={noop} />);
    expect(screen.getByText("Configuração de mobilidade incompleta — avise o TI; mantida a base anterior")).toBeTruthy();
  });

  it("the seller view (no mobility) shows nothing about mobility", async () => {
    await render(<SyncPanel status={idle} connectivity="online" onSyncNow={noop} />);
    expect(screen.queryByText(/visíveis|mobilidade/)).toBeNull();
  });
});
