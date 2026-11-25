import { describe, expect, it } from "vitest";
import { buildCreateBody, createProblems, emptyCreateForm, isNaturalPerson } from "./customer-form";

const CPF = "52998224725";
const CNPJ = "11222333000181";
const form = (patch: Partial<ReturnType<typeof emptyCreateForm>>) => ({ ...emptyCreateForm(), name: "Alfa", ...patch });

describe("customer create form rules", () => {
  it("a CPF never gets a state-registration problem, even with leftovers typed before", () => {
    expect(isNaturalPerson(CPF)).toBe(true);
    expect(createProblems(form({ document: CPF, stateRegistration: "123", exempt: true })).stateRegistration).toBeNull();
    expect(buildCreateBody("id", form({ document: CPF, stateRegistration: "123", exempt: true })).stateRegistration).toBeNull();
  });

  it("a CNPJ marked Isento has no state-registration problem and sends ISENTO", () => {
    const exempt = form({ document: CNPJ, exempt: true });
    expect(createProblems(exempt).stateRegistration).toBeNull();
    expect(buildCreateBody("id", exempt).stateRegistration).toBe("ISENTO");
    expect(createProblems(form({ document: CNPJ })).stateRegistration).toMatch(/Informe a inscrição estadual/);
  });

  it("the seller is required only when the user has no ERP seller code", () => {
    expect(createProblems(form({ document: CNPJ, exempt: true }), true).sellerCode).toBe("Escolha o vendedor.");
    expect(createProblems(form({ document: CNPJ, exempt: true, sellerCode: "7" }), true).sellerCode).toBeNull();
    expect(createProblems(form({ document: CNPJ, exempt: true }), false).sellerCode).toBeNull();
    expect(buildCreateBody("id", form({ document: CNPJ, sellerCode: "7" })).sellerCode).toBe(7);
    expect(buildCreateBody("id", form({ document: CNPJ })).sellerCode).toBeUndefined();
  });
});
