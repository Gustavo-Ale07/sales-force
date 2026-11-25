import { fireEvent, render, screen } from "@testing-library/react-native";
import { withModal } from "../test-render";
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

describe("SyncPanel on-demand sync", () => {
  it("says the situation in one sentence", async () => {
    const status: SyncStatus = { ...idle, phase: "offline", failure: "server_unavailable", lastError: "x" };
    await render(<SyncPanel status={status} connectivity="online" onSyncNow={noop} />);
    expect(screen.getByText("Servidor do Force indisponível — alterações salvas neste aparelho, tentaremos de novo")).toBeTruthy();
  });

  it("while syncing shows a single (disabled) 'Sincronizando…' button and no step detail", async () => {
    await render(<SyncPanel status={{ ...idle, phase: "syncing", progress: { label: "Atualizando preços", percent: 40 } }} connectivity="online" onSyncNow={noop} />);
    expect(screen.queryByText(/Atualizando preços/)).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("lists the orders in attention with the reason", async () => {
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
  });

  it("pressing the button runs the sync", async () => {
    const onSyncNow = jest.fn();
    await render(<SyncPanel status={idle} connectivity="online" onSyncNow={onSyncNow} />);
    await fireEvent.press(screen.getByRole("button", { name: "Sincronizar agora" }));
    expect(onSyncNow).toHaveBeenCalledTimes(1);
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

describe("SyncPanel hides technical diagnostics from the seller (owner 2026-11-25)", () => {
  it("shows no mobility tallies and no incomplete-configuration banner", async () => {
    const mobility = [
      { kind: "products" as const, visible: 90, hidden: 10, keptPrevious: false },
      { kind: "tops" as const, visible: 2, hidden: 1, keptPrevious: true },
    ];
    await render(<SyncPanel status={{ ...idle, mobility }} connectivity="online" onSyncNow={noop} />);
    expect(screen.queryByText(/visíveis|ocultos?|Produtos|Tipos de operação|Condições de pagamento/)).toBeNull();
    expect(screen.queryByText(/Configuração|avise o TI/)).toBeNull();
  });

  it("shows no connection row, no age row and no failed-steps line", async () => {
    const status: SyncStatus = { ...idle, failure: "sankhya_unavailable", failedSteps: ["Preços"], lastSyncedAt: new Date().toISOString() };
    await render(<SyncPanel status={status} connectivity="online" onSyncNow={noop} />);
    expect(screen.queryByText(/Conexão|Internet:|Servidor:|Dados atualizados|Não atualizado/)).toBeNull();
  });

  it("shows the pending row only when there is something pending", async () => {
    await render(<SyncPanel status={idle} connectivity="online" onSyncNow={noop} />);
    expect(screen.queryByText("Alterações pendentes")).toBeNull();
    await render(<SyncPanel status={{ ...idle, pending: 3 }} connectivity="online" onSyncNow={noop} />);
    expect(screen.getByText("Alterações pendentes")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });
});
