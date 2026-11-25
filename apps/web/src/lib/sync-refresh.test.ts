import { describe, expect, it } from "vitest";
import { clockTime, failedSteps, stepProgress, type SyncRefresh, type SyncRefreshStep } from "./sync-refresh";

const step = (patch: Partial<SyncRefreshStep>): SyncRefreshStep =>
  ({ entity: "orderStatus", status: "skipped", rowsRead: null, durationMs: 1, reason: null, lastSuccessAt: null, ...patch }) as SyncRefreshStep;

describe("refresh progress", () => {
  it("a skipped step is not a failed step; a failed one is", () => {
    expect(failedSteps({ steps: [step({})] } as unknown as SyncRefresh)).toHaveLength(0);
    expect(failedSteps({ steps: [step({ status: "failed" })] } as unknown as SyncRefresh)).toHaveLength(1);
  });

  it("counts finished steps into a percentage", () => {
    expect(stepProgress([step({ status: "ok" }), step({ status: "running" })]).percent).toBe(50);
    expect(stepProgress([]).percent).toBe(0);
  });

  it("formats the time of the data in Brasília time", () => {
    expect(clockTime("2026-11-06T17:00:00.000Z")).toBe("14:00");
  });

  it("no longer exposes per-entity texts or visible/hidden tallies", async () => {
    const module = (await import("./sync-refresh")) as Record<string, unknown>;
    for (const name of ["ENTITY_LABELS", "ENTITY_ACTION", "REFRESH_GROUPS", "stepNote", "mobilityNote", "MOBILITY_KEPT_WARNING"]) expect(module[name]).toBeUndefined();
  });
});
