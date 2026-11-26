import { describe, expect, it } from "vitest";
import { notificationTarget } from "./notificacoes";
import { filterTasks, isLate } from "./tarefas";

const base = { id: "1", type: "call", status: "pending", dueAt: "2026-11-25T12:00:00.000Z" } as never;

describe("tarefas helpers", () => {
  const now = Date.parse("2026-11-26T12:00:00.000Z");
  it("marks only pending past-due tasks as late", () => {
    expect(isLate(base, now)).toBe(true);
    expect(isLate({ ...(base as object), status: "completed" } as never, now)).toBe(false);
  });
  it("filters by type and lateness", () => {
    expect(filterTasks([base], "visit", false, now)).toHaveLength(0);
    expect(filterTasks([base], "call", true, now)).toHaveLength(1);
  });
  it("routes a notification to its record", () => {
    expect(notificationTarget({ refType: "order", refId: "abc" })).toEqual({ to: "/pedidos/$orderId", params: { orderId: "abc" } });
    expect(notificationTarget({ refType: "task", refId: "t" }).to).toBe("/tarefas");
  });
});
