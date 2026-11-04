import { describe, expect, it } from "vitest";
import { ApiRequestError } from "./api";
import { submitConflictText } from "./error-message";

const conflict = (reason?: string) => new ApiRequestError({ status: 409, code: "conflict", message: "x", ...(reason ? { reason } : {}) });

describe("K4: texto por motivo do 409 do envio", () => {
  it.each([
    ["dataset_not_erp", /dados de teste/],
    ["environment_mismatch", /outro ambiente/],
    ["edit_before_resubmitting", /reprovado/],
    ["needs_manager_approval", /gestor/],
  ])("%s has its own text", (reason, pattern) => {
    expect(submitConflictText(conflict(reason))).toMatch(pattern);
  });

  it("an unknown reason, no reason or another status falls back (null)", () => {
    expect(submitConflictText(conflict("something_new"))).toBeNull();
    expect(submitConflictText(conflict())).toBeNull();
    expect(submitConflictText(new ApiRequestError({ status: 500, message: "x", reason: "dataset_not_erp" }))).toBeNull();
  });

  it("never echoes the server's environment or dataset names", () => {
    for (const reason of ["dataset_not_erp", "environment_unbound", "environment_mismatch", "legacy_dataset"]) {
      expect(submitConflictText(conflict(reason))).not.toMatch(/sandbox|production|staging|fake|sankhya_/i);
    }
  });
});
