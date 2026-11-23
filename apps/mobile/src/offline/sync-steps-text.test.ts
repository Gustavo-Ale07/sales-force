import type { SyncStep, SyncStepId, SyncStepState } from "@salesforce/mobile-db";
import { currentStepText, failureCode, overallFraction, sellerSteps, stepFraction } from "./sync-steps-text";

const step = (id: SyncStepId, state: SyncStepState, over: Partial<SyncStep> = {}): SyncStep => ({ id, state, count: null, total: null, indeterminate: false, ...over });

const IDS: SyncStepId[] = ["push", "server", "customers", "products", "prices", "negotiation", "carriers", "save", "orders"];
function all(states: Partial<Record<SyncStepId, SyncStepState>>, fallback: SyncStepState = "pending", over: Partial<Record<SyncStepId, Partial<SyncStep>>> = {}): SyncStep[] {
  return IDS.map((id) => step(id, states[id] ?? fallback, over[id]));
}

describe("stepFraction", () => {
  it("is 1 when done and 0 when pending", () => {
    expect(stepFraction(step("customers", "done"))).toBe(1);
    expect(stepFraction(step("customers", "pending"))).toBe(0);
  });

  it("follows count over total while running, capped at 1", () => {
    expect(stepFraction(step("products", "running", { count: 120, total: 480 }))).toBe(0.25);
    expect(stepFraction(step("products", "running", { count: 600, total: 480 }))).toBe(1);
  });

  it("is unknown (null) when running without a total, with total 0 or without a count", () => {
    expect(stepFraction(step("products", "running"))).toBeNull();
    expect(stepFraction(step("products", "running", { count: 5, total: null }))).toBeNull();
    expect(stepFraction(step("products", "running", { count: 0, total: 0 }))).toBeNull();
    expect(stepFraction(step("products", "running", { count: null, total: 10 }))).toBeNull();
  });

  it("an error counts as finished (the failure is reported by the popup, not by the bar)", () => {
    expect(stepFraction(step("products", "error", { count: 1, total: 2 }))).toBe(1);
  });
});

describe("sellerSteps", () => {
  it("groups the nine internal steps into at most five labelled steps, sending first, never showing counts", () => {
    const list = sellerSteps(all({}, "pending", { push: { total: 2 } }));
    expect(list.map((entry) => entry.id)).toEqual(["send", "customers", "products", "conditions", "finishing"]);
    expect(list.map((entry) => entry.label)).toEqual(["Enviando pedidos", "Clientes", "Produtos e preços", "Condições de venda", "Finalizando"]);
    expect(list.every((entry) => entry.state === "pending")).toBe(true);
    expect(JSON.stringify(list)).not.toMatch(/count|total/);
  });

  it("orders are sent BEFORE the downloads (send is the first entry)", () => {
    expect(sellerSteps(all({}, "pending", { push: { count: 1 } }))[0]?.id).toBe("send");
  });

  it("hides the sending step when there is nothing to send", () => {
    expect(sellerSteps(all({})).map((entry) => entry.id)).not.toContain("send");
    expect(sellerSteps(all({}, "pending", { push: { count: 0, total: 0 } })).map((entry) => entry.id)).not.toContain("send");
  });

  it("a group is running when any member runs or some (not all) finished, done only when all finished", () => {
    const list = sellerSteps(all({ server: "done", customers: "running", products: "done", prices: "done", negotiation: "pending" }));
    const byId = Object.fromEntries(list.map((entry) => [entry.id, entry.state]));
    expect(byId).toMatchObject({ customers: "running", products: "done", conditions: "pending" });
    expect(sellerSteps(all({ products: "done" })).find((entry) => entry.id === "products")?.state).toBe("running");
  });

  it("a member in error counts as finished", () => {
    expect(sellerSteps(all({ products: "error", prices: "done" })).find((entry) => entry.id === "products")?.state).toBe("done");
  });

  it("skips groups with no member steps", () => {
    expect(sellerSteps([step("customers", "pending")]).map((entry) => entry.id)).toEqual(["customers"]);
    expect(sellerSteps([])).toEqual([]);
  });
});

describe("overallFraction", () => {
  it("is 0 for no steps and 1 when everything is done", () => {
    expect(overallFraction([])).toBe(0);
    expect(overallFraction(all({}, "done"))).toBe(1);
  });

  it("ignores the send step when there is nothing to send, counts it when there is", () => {
    const nothing = all({ push: "pending" }, "done");
    expect(overallFraction(nothing)).toBe(1);
    const something = all({ push: "pending" }, "done", { push: { count: 3, total: 3 } });
    expect(overallFraction(something)).toBeCloseTo(8 / 9, 5);
  });

  it("averages the real per-step fractions, unknown running steps count as 0", () => {
    const list = [step("customers", "done"), step("products", "running", { count: 1, total: 2 }), step("prices", "running"), step("save", "pending")];
    expect(overallFraction(list)).toBeCloseTo((1 + 0.5 + 0 + 0) / 4, 5);
  });
});

describe("currentStepText", () => {
  it("names the running seller step", () => {
    expect(currentStepText(all({ server: "done", customers: "running" }))).toBe("Clientes");
  });

  it("falls back to the first pending step, then to 'Finalizando'", () => {
    expect(currentStepText(all({}))).toBe("Clientes");
    expect(currentStepText(all({}, "done"))).toBe("Finalizando");
    expect(currentStepText([])).toBe("Finalizando");
  });

  it("starts with 'Enviando pedidos' when there are orders to send", () => {
    expect(currentStepText(all({ push: "running" }, "pending", { push: { total: 1 } }))).toBe("Enviando pedidos");
  });
});

describe("failureCode", () => {
  it.each([
    ["no_internet", "offline"],
    ["server_unavailable", "service_unavailable"],
    ["sankhya_unavailable", "sankhya_unavailable"],
    ["auth", "unauthenticated"],
    ["error", "sync_failed"],
    ["anything else", "sync_failed"],
    [null, "sync_failed"],
    [undefined, "sync_failed"],
  ])("%s -> %s", (failure, code) => {
    expect(failureCode(failure as string | null | undefined)).toBe(code);
  });
});
