import type { SyncStatus } from "@salesforce/mobile-db";
import { describeSyncChip, describeSyncStatus } from "./sync-status-text";

const idle: SyncStatus = { phase: "idle", pending: 0, needsAttention: 0, lastSyncedAt: null, lastError: null, failure: null, failedSteps: [], attention: [], progress: null };
const noInternet: SyncStatus = { ...idle, phase: "offline", failure: "no_internet", lastError: "x" };
const serverDown: SyncStatus = { ...idle, phase: "offline", failure: "server_unavailable", lastError: "x" };
const sankhyaDown: SyncStatus = { ...idle, failure: "sankhya_unavailable", failedSteps: ["Preços"], lastError: "x" };
const at = (h: number, m: number) => new Date(2026, 10, 13, h, m, 0).toISOString();
const now = new Date(2026, 10, 13, 18, 0, 0).getTime();

describe("Situação (owner's exact wording, 2026-11-13)", () => {
  it("no internet", () => {
    expect(describeSyncStatus(noInternet, "online").text).toBe("Sem internet — alterações salvas neste aparelho");
    expect(describeSyncStatus(idle, "offline").text).toBe("Sem internet — alterações salvas neste aparelho");
  });
  it("Force server unavailable", () => {
    expect(describeSyncStatus(serverDown, "online")).toEqual({ text: "Servidor do Force indisponível — alterações salvas neste aparelho, tentaremos de novo", tone: "offline" });
  });
  it("Sankhya unavailable keeps the old data and is not 'offline'", () => {
    const view = describeSyncStatus(sankhyaDown, "online");
    expect(view.text).toBe("Sankhya indisponível — mantendo os dados da última sincronização");
    expect(view.tone).not.toBe("offline");
  });
  it("synced shows the time of the last successful sync", () => {
    expect(describeSyncStatus({ ...idle, lastSyncedAt: at(14, 5) }, "online").text).toBe("Sincronizado às 14:05");
    expect(describeSyncStatus(idle, "online").text).toBe("Sincronizado");
  });
  it("an order in attention is visible even when the sync itself went well", () => {
    expect(describeSyncStatus({ ...idle, needsAttention: 1, lastSyncedAt: at(14, 5) }, "online").text).toBe("1 pedido precisa de atenção");
  });
});

describe("chip: Offline only without internet or server; Atenção for an order; Erro only for a real failure", () => {
  it("offline", () => {
    expect(describeSyncChip(noInternet, "online", now).text).toBe("Offline");
    expect(describeSyncChip(serverDown, "online", now).text).toBe("Offline");
    expect(describeSyncChip(idle, "offline", now).text).toBe("Offline");
  });
  it("Sankhya down is not Offline", () => {
    const chip = describeSyncChip(sankhyaDown, "online", now);
    expect(chip.text).not.toMatch(/Offline|Erro/);
    expect(chip.text).toBe("Sankhya indisponível");
  });
  it("an order in attention says Atenção, not Erro", () => {
    expect(describeSyncChip({ ...idle, needsAttention: 2 }, "online", now).text).toBe("Atenção");
  });
  it("Erro appears only for a real failure", () => {
    expect(describeSyncChip({ ...idle, phase: "error", failure: "error", lastError: "x" }, "online", now).text).toBe("Falhou. Tentar de novo");
    expect(describeSyncChip({ ...idle, needsAttention: 2 }, "online", now).text).not.toMatch(/Erro/);
  });
});
