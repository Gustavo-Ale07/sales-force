import { describe, expect, it } from "vitest";
import { isDataStale, syncIndicatorView, type SyncIndicatorInput } from "./sync-indicator";

const ok: SyncIndicatorInput = { online: true, syncing: false, failed: false, needsCorrection: false, awaitingSend: false, stale: false, retrying: false };

describe("syncIndicatorView", () => {
  it("is green and says Sincronizado when nothing needs attention", () => {
    expect(syncIndicatorView(ok)).toEqual({ color: "green", label: "Status de sincronização: Sincronizado", spinning: false });
  });
  it("keeps the colour while spinning", () => {
    expect(syncIndicatorView({ ...ok, syncing: true })).toMatchObject({ color: "green", spinning: true, label: "Status de sincronização: Sincronizando" });
    expect(syncIndicatorView({ ...ok, syncing: true, needsCorrection: true })).toMatchObject({ color: "red", spinning: true });
  });
  it("is yellow for offline, awaiting send, stale and retrying", () => {
    expect(syncIndicatorView({ ...ok, online: false })).toMatchObject({ color: "yellow", label: "Status de sincronização: Sem conexão" });
    expect(syncIndicatorView({ ...ok, awaitingSend: true })).toMatchObject({ color: "yellow", label: "Status de sincronização: Pedidos aguardando envio" });
    expect(syncIndicatorView({ ...ok, stale: true })).toMatchObject({ color: "yellow", label: "Status de sincronização: Dados desatualizados" });
    expect(syncIndicatorView({ ...ok, retrying: true }).color).toBe("yellow");
  });
  it("ignores a failed last sync while syncing", () => {
    expect(syncIndicatorView({ ...ok, syncing: true, failed: true })).toMatchObject({ color: "green", spinning: true });
  });
  it("is red for a failed refresh or an order that needs correction, over yellow", () => {
    expect(syncIndicatorView({ ...ok, failed: true, online: false })).toMatchObject({ color: "red", label: "Status de sincronização: Erro na última sincronização" });
    expect(syncIndicatorView({ ...ok, needsCorrection: true, awaitingSend: true }).color).toBe("red");
  });
});

describe("isDataStale", () => {
  const now = Date.parse("2026-11-24T12:00:00Z");
  it("flags data older than 24 h only", () => {
    expect(isDataStale("2026-11-23T11:00:00Z", now)).toBe(true);
    expect(isDataStale("2026-11-24T08:00:00Z", now)).toBe(false);
    expect(isDataStale(null, now)).toBe(false);
  });
});
