import type { SyncStep, SyncStepId, SyncStepState } from "@salesforce/mobile-db";
import { failureCode, overallText, STEP_LABEL, stepAccessibilityLabel, stepCountText, stepFraction } from "./sync-steps-text";

const step = (id: SyncStepId, state: SyncStepState, over: Partial<SyncStep> = {}): SyncStep => ({ id, state, count: null, total: null, indeterminate: false, ...over });

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

  it("is unknown for an error", () => {
    expect(stepFraction(step("products", "error", { count: 1, total: 2 }))).toBeNull();
  });
});

describe("stepCountText", () => {
  it("is empty while pending", () => {
    expect(stepCountText(step("customers", "pending"))).toBe("");
  });

  it("running: 'N de T' with a total, N alone without, nothing at 0 or unknown", () => {
    expect(stepCountText(step("customers", "running", { count: 120, total: 480 }))).toBe("120 de 480");
    expect(stepCountText(step("customers", "running", { count: 7 }))).toBe("7");
    expect(stepCountText(step("customers", "running", { count: 0 }))).toBe("");
    expect(stepCountText(step("customers", "running"))).toBe("");
  });

  it("the server step waits for the server while running and shows nothing when done", () => {
    expect(stepCountText(step("server", "running"))).toBe("aguardando o servidor");
    expect(stepCountText(step("server", "done"))).toBe("");
  });

  it("running prices with a note show the table remark and the real count", () => {
    expect(stepCountText(step("prices", "running", { count: 300, note: "tabela 5" }))).toBe("tabela 5 · 300 preços");
  });

  it("push done: 'Nada a enviar', singular and plural", () => {
    expect(stepCountText(step("push", "done", { count: null }))).toBe("Nada a enviar");
    expect(stepCountText(step("push", "done", { count: 0 }))).toBe("Nada a enviar");
    expect(stepCountText(step("push", "done", { count: 1 }))).toBe("1 enviado");
    expect(stepCountText(step("push", "done", { count: 3 }))).toBe("3 enviados");
  });

  it("prices done with a note: count and remark", () => {
    expect(stepCountText(step("prices", "done", { count: 900, note: "mantidas as anteriores" }))).toBe("900 preços · mantidas as anteriores");
    expect(stepCountText(step("prices", "done", { count: null, note: "x" }))).toBe("0 preços · x");
    expect(stepCountText(step("prices", "done", { count: 900 }))).toBe("900");
  });

  it("save and orders show no count when done; other steps show the number", () => {
    expect(stepCountText(step("save", "done", { count: 10 }))).toBe("");
    expect(stepCountText(step("orders", "done", { count: 10 }))).toBe("");
    expect(stepCountText(step("carriers", "done", { count: 12 }))).toBe("12");
    expect(stepCountText(step("carriers", "done"))).toBe("");
  });

  it("error: the step's note (the seller-safe remark) or nothing", () => {
    expect(stepCountText(step("products", "error", { note: "mantidos os anteriores" }))).toBe("mantidos os anteriores");
    expect(stepCountText(step("products", "error"))).toBe("");
  });
});

describe("stepAccessibilityLabel", () => {
  it("reads label, state and count", () => {
    expect(stepAccessibilityLabel(step("customers", "running", { count: 120, total: 480 }))).toBe("Clientes: em andamento, 120 de 480");
    expect(stepAccessibilityLabel(step("prices", "pending"))).toBe("Preços: aguardando");
    expect(stepAccessibilityLabel(step("push", "done", { count: 2 }))).toBe("Enviando pedidos e pendências: concluído, 2 enviados");
    expect(stepAccessibilityLabel(step("products", "error"))).toBe("Produtos: com problema");
  });
});

describe("overallText", () => {
  it("counts finished (done or error) steps over all", () => {
    const steps = [step("push", "done"), step("server", "error"), step("customers", "running"), step("products", "pending")];
    expect(overallText(steps)).toBe("2 de 4 etapas");
    expect(overallText([])).toBe("0 de 0 etapas");
  });
});

describe("STEP_LABEL", () => {
  it("never uses the word rascunho", () => {
    expect(Object.values(STEP_LABEL).join(" ")).not.toMatch(/rascunho/i);
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
