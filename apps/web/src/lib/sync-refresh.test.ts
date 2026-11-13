import { describe, expect, it } from "vitest";
import { failedSteps, mobilityNote, stepNote, type SyncRefresh, type SyncRefreshStep } from "./sync-refresh";

const NOT_AVAILABLE = "Status dos pedidos no Sankhya: ainda não disponível";
const step = (patch: Partial<SyncRefreshStep>): SyncRefreshStep =>
  ({ entity: "orderStatus", status: "skipped", rowsRead: null, durationMs: 1, reason: null, lastSuccessAt: null, ...patch }) as SyncRefreshStep;

describe("refresh step note (detail panel only)", () => {
  it("a not-available order-status step shows the discreet text and is not a failed step", () => {
    const unavailable = step({ reason: NOT_AVAILABLE });
    expect(stepNote(unavailable)).toBe(NOT_AVAILABLE);
    expect(failedSteps({ steps: [unavailable] } as unknown as SyncRefresh)).toHaveLength(0);
  });

  it("a failed step still reports its reason and the kept data", () => {
    const failed = step({ status: "failed", reason: "Falhou." });
    expect(stepNote(failed)).toBe("Falhou. Mantidos os dados anteriores.");
    expect(failedSteps({ steps: [failed] } as unknown as SyncRefresh)).toHaveLength(1);
  });

  it("an ok step has no note", () => {
    expect(stepNote(step({ status: "ok" }))).toBeNull();
  });
});

describe("mobility note (detail panel only)", () => {
  it("is null when the server sent no mobility counts (seller view / other entities)", () => {
    expect(mobilityNote(step({ status: "ok" }))).toBeNull();
    expect(mobilityNote(step({ status: "ok", mobility: [] }))).toBeNull();
  });

  it("lists visible and hidden counts per kind", () => {
    const note = mobilityNote(
      step({ status: "ok", mobility: [{ kind: "products", visible: 1200, hidden: 30, keptPrevious: false }, { kind: "tops", visible: 4, hidden: 0, keptPrevious: false }] }),
    );
    expect(note).toBe("Mobilidade — Produtos: 1.200 visíveis, 30 ocultos; TOPs: 4 visíveis, 0 ocultos");
  });

  it("warns when the previous base was kept", () => {
    const note = mobilityNote(step({ status: "ok", mobility: [{ kind: "negotiationTypes", visible: 0, hidden: 9, keptPrevious: true }] }));
    expect(note).toContain("Tipos de negociação: 0 visíveis, 9 ocultos");
    expect(note).toContain("Configuração de mobilidade incompleta — avise o TI; mantida a base anterior");
  });
});
