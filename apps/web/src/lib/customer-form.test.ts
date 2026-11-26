import { describe, expect, it } from "vitest";
import { buildCreateBody, createProblems, emptyCreateForm, formFieldOfServerPath, matchCode, stepHasProblems, stepOfField } from "./customer-form";

const CPF = "52998224725";
const CNPJ = "11222333000181";
const form = (patch: Partial<ReturnType<typeof emptyCreateForm>>) => ({ ...emptyCreateForm(), name: "Alfa", cityCode: 10, ...patch });

describe("customer create form rules", () => {
  it("a natural person never gets a state-registration problem, nor sends one or a trade name", () => {
    const natural = form({ personType: "F", document: CPF, stateRegistration: "123", exempt: true, tradeName: "Fantasia" });
    expect(createProblems(natural).stateRegistration).toBeNull();
    const body = buildCreateBody("id", natural);
    expect(body.stateRegistration).toBeNull();
    expect(body.tradeName).toBeNull();
  });

  it("the document must match the chosen person type", () => {
    expect(createProblems(form({ personType: "F", document: CNPJ })).document).toBe("CPF inválido.");
    expect(createProblems(form({ personType: "J", document: CPF })).document).toBe("CNPJ inválido.");
    expect(createProblems(form({ personType: "J", document: CNPJ, exempt: true })).document).toBeNull();
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

  it("the city is the only mandatory address field and belongs to screen 2", () => {
    const problems = createProblems(form({ document: CNPJ, exempt: true, cityCode: null }));
    expect(problems.cityCode).toBe("Informe a cidade.");
    expect(stepHasProblems(problems, 0)).toBe(false);
    expect(stepHasProblems(problems, 1)).toBe(true);
    expect(stepHasProblems(problems, 2)).toBe(false);
    expect(stepOfField("cityCode")).toBe(1);
    expect(stepOfField("sellerCode")).toBe(2);
    expect(stepOfField("document")).toBe(0);
  });

  it("sends registry codes for picked suggestions and free text otherwise", () => {
    const picked = buildCreateBody("id", form({ document: CNPJ, street: "RUA A", streetCode: 5, neighborhood: "Centro", neighborhoodCode: null, number: "10", postalCode: "01310-100" }));
    expect(picked.addresses).toEqual([
      { cityCode: 10, streetCode: 5, neighborhoodCode: 0, streetName: null, neighborhoodName: "Centro", number: "10", complement: null, postalCode: "01310100" },
    ]);
    expect(buildCreateBody("id", form({ document: CNPJ, cityCode: null })).addresses).toEqual([]);
  });

  it("matches a typed name to a registry row without accents or case", () => {
    expect(matchCode("  são joão ", [{ code: 3, name: "SAO JOAO" }])).toBe(3);
    expect(matchCode("outro", [{ code: 3, name: "SAO JOAO" }])).toBeNull();
    expect(matchCode("", [{ code: 3, name: "" }])).toBeNull();
  });

  it("moves a server refusal of the address to the form field", () => {
    expect(formFieldOfServerPath("addresses.0.cityCode")).toBe("cityCode");
    expect(formFieldOfServerPath("addresses.0.streetName")).toBe("street");
    expect(formFieldOfServerPath("seller")).toBe("sellerCode");
    expect(formFieldOfServerPath("document")).toBe("document");
  });
});
