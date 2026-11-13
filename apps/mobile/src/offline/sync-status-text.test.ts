import type { SyncStatus } from "@salesforce/mobile-db";
import { describeConnection, describeSyncAge, describeSyncChip, describeSyncStatus } from "./sync-status-text";

const idle: SyncStatus = { phase: "idle", pending: 0, needsAttention: 0, lastSyncedAt: null, lastError: null, failure: null, failedSteps: [], attention: [], progress: null };
const noInternet: SyncStatus = { ...idle, phase: "offline", failure: "no_internet", lastError: "x" };
const serverDown: SyncStatus = { ...idle, phase: "offline", failure: "server_unavailable", lastError: "x" };
const sankhyaDown: SyncStatus = { ...idle, failure: "sankhya_unavailable", failedSteps: ["Preços"], lastError: "x" };
const at = (h: number, m: number) => new Date(2026, 10, 13, h, m, 0).toISOString();
const now = new Date(2026, 10, 13, 18, 0, 0).getTime();

describe("age of the last successful sync", () => {
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const MIN = 60_000;
  const H = 60 * MIN;
  it("says how old the data is in pt-BR", () => {
    expect(describeSyncAge(ago(20_000), now)?.text).toBe("agora há pouco");
    expect(describeSyncAge(ago(5 * MIN), now)?.text).toBe("há 5 min");
    expect(describeSyncAge(ago(3 * H + 10 * MIN), now)?.text).toBe("há 3 h");
    expect(describeSyncAge(ago(30 * H), now)?.text).toBe("há 1 dia");
    expect(describeSyncAge(ago(50 * H), now)?.text).toBe("há 2 dias");
  });
  it("is stale (amber) from 24 h on, never before", () => {
    expect(describeSyncAge(ago(23 * H + 59 * MIN), now)?.stale).toBe(false);
    expect(describeSyncAge(ago(24 * H), now)?.stale).toBe(true);
    expect(describeSyncAge(ago(5 * 24 * H), now)?.stale).toBe(true);
  });
  it("a clock slightly in the future reads as just now; no sync or garbage gives nothing", () => {
    expect(describeSyncAge(ago(-5 * MIN), now)).toEqual({ text: "agora há pouco", stale: false });
    expect(describeSyncAge(null, now)).toBeNull();
    expect(describeSyncAge("not a date", now)).toBeNull();
  });
});

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
    expect(describeSyncStatus({ ...idle, lastSyncedAt: at(14, 5) }, "online").text).toBe("✓ Sincronizado às 14:05");
    expect(describeSyncStatus(idle, "online").text).toBe("✓ Sincronizado");
  });
  it("an order in attention is visible even when the sync itself went well", () => {
    expect(describeSyncStatus({ ...idle, needsAttention: 1, lastSyncedAt: at(14, 5) }, "online").text).toBe("1 pedido precisa de atenção");
  });
});

describe("Conexão line is the same verification as Situação", () => {
  it("internet ok, server not answering", () => {
    expect(describeConnection(serverDown, "online")).toBe("Internet: ok · Servidor: sem resposta");
  });
  it("no internet: server not checked", () => {
    expect(describeConnection(noInternet, "offline")).toBe("Internet: sem sinal · Servidor: não verificado");
    expect(describeConnection(idle, "offline")).toBe("Internet: sem sinal · Servidor: não verificado");
  });
  it("all good", () => {
    expect(describeConnection({ ...idle, lastSyncedAt: at(14, 5) }, "online")).toBe("Internet: ok · Servidor: ok");
  });
  it("Sankhya down: internet and server fine, Sankhya named", () => {
    expect(describeConnection(sankhyaDown, "online")).toBe("Internet: ok · Servidor: ok · Sankhya: indisponível");
  });
  it("never contradicts Situação: a 'no internet' Situação never pairs with 'Internet: ok'", () => {
    for (const [status, connectivity] of [[noInternet, "online"], [idle, "offline"], [serverDown, "online"]] as const) {
      const situation = describeSyncStatus(status, connectivity).text;
      const line = describeConnection(status, connectivity);
      if (situation.startsWith("Sem internet")) expect(line).toContain("Internet: sem sinal");
      if (situation.startsWith("Servidor do Force")) expect(line).toContain("Servidor: sem resposta");
    }
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
