import { CUSTOMER_UNAVAILABLE_MESSAGE, LEGACY_CUSTOMER_UNAVAILABLE_MESSAGE, isCustomerUnavailableMessage } from "@salesforce/mobile-db";
import { codeOfHeldMessage } from "../data/error-catalog";
import { draftRecord } from "../test-doubles";
import { isCustomerUnavailable, saleBadge, saleExplanation } from "./sales-status";

/**
 * Drafts held before the word "rascunho" left the UI (2026-11) still carry the old marker in `lastError`.
 * It must stay recognized (no migration rewrites stored text), and must read as the new wording on screen.
 */
describe("legacy stored marker 'Cliente indisponível — revise o rascunho'", () => {
  it("is the old text, distinct from the current marker", () => {
    expect(LEGACY_CUSTOMER_UNAVAILABLE_MESSAGE).toBe("Cliente indisponível — revise o rascunho");
    expect(CUSTOMER_UNAVAILABLE_MESSAGE).not.toMatch(/rascunho/i);
  });

  it("is still recognized as a customer-unavailable hold", () => {
    expect(isCustomerUnavailableMessage("Cliente indisponível — revise o rascunho")).toBe(true);
    expect(isCustomerUnavailableMessage(CUSTOMER_UNAVAILABLE_MESSAGE)).toBe(true);
    expect(isCustomerUnavailableMessage("Outro erro")).toBe(false);
    expect(isCustomerUnavailableMessage(null)).toBe(false);
  });

  it("resolves to the customer_unavailable catalog code", () => {
    expect(codeOfHeldMessage("Cliente indisponível — revise o rascunho")).toBe("customer_unavailable");
  });

  it("marks the draft as held, with the badge and an explanation that never says rascunho", () => {
    const held = draftRecord({ status: "sync_error", lastError: "Cliente indisponível — revise o rascunho" });
    expect(isCustomerUnavailable(held)).toBe(true);
    expect(saleBadge(held)).toEqual({ label: "Cliente indisponível", tone: "warning" });
    const explanation = saleExplanation(held);
    expect(explanation).toContain("Cliente indisponível — revise o pedido");
    expect(explanation).toContain("O cadastro deste cliente mudou (inativo ou bloqueado).");
    expect(explanation).not.toMatch(/rascunho/i);
  });
});
