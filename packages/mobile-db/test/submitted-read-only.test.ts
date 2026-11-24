import { describe, expect, it } from "vitest";
import { isSubmittedReadOnly } from "../src/local-orders";

describe("isSubmittedReadOnly", () => {
  it("a rejected order (Precisa de correção) without a Sankhya number is editable", () => {
    expect(isSubmittedReadOnly({ sendState: "submitted", sendCode: "rejected", erpNumber: null, erpStage: null })).toBe(false);
    expect(isSubmittedReadOnly({ sendState: "submitted", sendCode: "rejected" })).toBe(false);
  });

  it("a rejected order that already carries a Sankhya number stays read-only (SNK-4)", () => {
    expect(isSubmittedReadOnly({ sendState: "submitted", sendCode: "rejected", erpNumber: 123456, erpStage: null })).toBe(true);
  });

  it("the other submitted statuses keep their rule", () => {
    for (const code of ["draft", "awaiting_approval", "approval_rejected"]) {
      expect(isSubmittedReadOnly({ sendState: "submitted", sendCode: code })).toBe(false);
    }
    for (const code of ["queued", "sent", "unknown", "approved"]) {
      expect(isSubmittedReadOnly({ sendState: "submitted", sendCode: code })).toBe(true);
    }
    expect(isSubmittedReadOnly({ sendState: "requested", sendCode: null })).toBe(false);
  });
});
