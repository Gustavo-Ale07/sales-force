import { describe, expect, it } from "vitest";
import { SYNC_INDICATOR_HEX, isDataStale, syncIndicatorView, type SyncIndicatorInput } from "./sync-indicator";

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

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe("SYNC_INDICATOR_HEX", () => {
  // Header background = --sf-navy (packages/ui/src/styles/index.css), the colour behind the arrows.
  const HEADER = "#01136a";
  it.each(["green", "yellow", "red"] as const)("%s arrows read on the header navy (>= 3:1 for graphics)", (color) => {
    expect(contrast(SYNC_INDICATOR_HEX[color], HEADER)).toBeGreaterThanOrEqual(3);
  });
  it("uses the same hex as the app", () => {
    expect(SYNC_INDICATOR_HEX).toEqual({ green: "#4ADE80", yellow: "#FBBF24", red: "#F87171" });
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
