import { describe, expect, it } from "vitest";
import { failedSteps, stepNote, type SyncRefresh, type SyncRefreshStep } from "./sync-refresh";

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
