import { render, screen } from "@testing-library/react-native";
import { AccessibilityInfo, StyleSheet } from "react-native";
import type { SyncStatus } from "@salesforce/mobile-db";
import { describeSyncChip, describeSyncIndicator, SYNC_INDICATOR_HEX } from "../offline/sync-status-text";
import { SyncStatusChip } from "./sync-status";
import { SyncIcon } from "./sync-icon";
import { colors } from "../theme";

const idle: SyncStatus = { phase: "idle", pending: 0, needsAttention: 0, lastSyncedAt: null, lastError: null };
const noop = () => undefined;
const now = Date.parse("2026-11-12T12:00:00.000Z");
const fresh = "2026-11-12T11:00:00.000Z";
const old = "2026-11-10T11:00:00.000Z";

describe("describeSyncChip wording", () => {
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

describe("describeSyncIndicator (state -> color -> label, shared with the site)", () => {
  const rows: Array<[string, SyncStatus, "online" | "offline", string, string]> = [
    ["ok", { ...idle, lastSyncedAt: fresh }, "online", "green", "Sincronizado"],
    ["never synced, nothing pending", idle, "online", "green", "Sincronizado"],
    ["last sync failed", { ...idle, phase: "error", lastError: "x", lastSyncedAt: fresh }, "online", "red", "Erro na última sincronização"],
    ["session expired", { ...idle, phase: "auth_required" }, "online", "red", "Erro na última sincronização"],
    ["order needs correction", { ...idle, needsAttention: 1, lastSyncedAt: fresh }, "online", "red", "Pedido precisa de correção"],
    ["correction beats offline", { ...idle, needsAttention: 1, pending: 2 }, "offline", "red", "Pedido precisa de correção"],
    ["offline (device)", { ...idle, lastSyncedAt: fresh }, "offline", "yellow", "Sem conexão"],
    ["server not answering", { ...idle, phase: "offline", failure: "server_unavailable", lastError: "x" }, "online", "yellow", "Sem conexão"],
    ["Sankhya unavailable", { ...idle, failure: "sankhya_unavailable", lastSyncedAt: fresh }, "online", "yellow", "Servidor instável, tentando de novo"],
    ["orders waiting", { ...idle, pending: 3, lastSyncedAt: fresh }, "online", "yellow", "Pedidos aguardando envio"],
    ["stale data (24 h or more)", { ...idle, lastSyncedAt: old }, "online", "yellow", "Dados desatualizados"],
  ];
  it.each(rows)("%s", (_name, status, connectivity, color, label) => {
    expect(describeSyncIndicator(status, connectivity, now)).toEqual({ color, label, spinning: false });
  });

  it("syncing: arrows spin and the dot keeps the color of the underlying state", () => {
    expect(describeSyncIndicator({ ...idle, phase: "syncing", lastSyncedAt: fresh }, "online", now)).toEqual({ color: "green", label: "Sincronizando", spinning: true });
    expect(describeSyncIndicator({ ...idle, phase: "syncing", pending: 2 }, "online", now)).toEqual({ color: "yellow", label: "Sincronizando. Pedidos aguardando envio", spinning: true });
    expect(describeSyncIndicator({ ...idle, phase: "syncing", needsAttention: 1 }, "online", now).color).toBe("red");
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
});

describe("header indicator dot", () => {
  const cases: Array<[string, SyncStatus, "online" | "offline", "green" | "yellow" | "red", string]> = [
    ["green", { ...idle, lastSyncedAt: fresh }, "online", "green", "Sincronizado"],
    ["yellow (waiting orders)", { ...idle, pending: 3, lastSyncedAt: fresh }, "online", "yellow", "Pedidos aguardando envio"],
    ["yellow (offline)", { ...idle, lastSyncedAt: fresh }, "offline", "yellow", "Sem conexão"],
    ["red (failure)", { ...idle, phase: "error", lastError: "x" }, "online", "red", "Erro na última sincronização"],
    ["red (needs correction)", { ...idle, needsAttention: 2, lastSyncedAt: fresh }, "online", "red", "Pedido precisa de correção"],
  ];
  it.each(cases)("%s: only the arrows, their line color is the state, label in words, no circle or background", async (_n, status, connectivity, color, label) => {
    await render(<SyncStatusChip status={status} connectivity={connectivity} now={now} onPress={noop} />);
    expect(screen.getByRole("button", { name: `Status de sincronização: ${label}` })).toBeTruthy();
    expect(screen.queryByText(label)).toBeNull();
    expect(screen.queryByTestId("sync-mark-anchor")).toBeNull();
    expect(screen.getByTestId("sync-arrows", { includeHiddenElements: true })).toBeTruthy();
    const json = JSON.stringify(screen.toJSON());
    expect(json).toContain(`"borderTopColor":"${SYNC_INDICATOR_HEX[color]}"`);
    expect(json).not.toContain("backgroundColor");
    expect(json).not.toContain(colors.onNavy);
  });

  it("every state color reads on the navy header (contrast >= 3:1 for graphics)", () => {
    const channel = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
    };
    const header = luminance(colors.navy);
    for (const hex of Object.values(SYNC_INDICATOR_HEX)) {
      expect((luminance(hex) + 0.05) / (header + 0.05)).toBeGreaterThanOrEqual(3);
    }
  });

  it("syncing: spinner keeps the state color", async () => {
    await render(<SyncStatusChip status={{ ...idle, phase: "syncing", pending: 1 }} connectivity="online" now={now} onPress={noop} />);
    expect(screen.getByTestId("sync-icon-spinner", { includeHiddenElements: true })).toBeTruthy();
    expect(JSON.stringify(screen.toJSON())).toContain(`"borderTopColor":"${SYNC_INDICATOR_HEX.yellow}"`);
    expect(screen.getByRole("button", { name: "Status de sincronização: Sincronizando. Pedidos aguardando envio" })).toBeTruthy();
  });

  it("is a 44 x 44 touch target without a white box", async () => {
    await render(<SyncStatusChip status={idle} connectivity="online" onPress={noop} />);
    const flat = StyleSheet.flatten(screen.getByRole("button", { name: /Status de sincronização/ }).props.style as never) as { minWidth: number; minHeight: number; backgroundColor?: string };
    expect(flat.minWidth).toBeGreaterThanOrEqual(44);
    expect(flat.minHeight).toBeGreaterThanOrEqual(44);
    expect(flat.backgroundColor).toBeUndefined();
  });
});
