import { applyCnpjAnswer, type CnpjAnswer } from "./customer-cnpj";
import { emptyCreateForm } from "./customer-form";

const found: CnpjAnswer = {
  found: true,
  legalName: "Metalurgica Exemplo Ltda",
  tradeName: "Exemplo",
  postalCode: "01310100",
  number: "100",
  complement: "Sala 2",
  phone: "11987654321",
  email: "contato@exemplo.test",
};

describe("applyCnpjAnswer", () => {
  it("fills the empty fields with masks", () => {
    const form = applyCnpjAnswer(emptyCreateForm(), found);
    expect(form).toMatchObject({
      name: "Metalurgica Exemplo Ltda",
      tradeName: "Exemplo",
      postalCode: "01310-100",
      phone: "(11) 98765-4321",
      number: "100",
      complement: "Sala 2",
      email: "contato@exemplo.test",
    });
  });

  it("never overwrites what the seller already typed", () => {
    const typed = { ...emptyCreateForm(), name: "Digitado", phone: "(21) 3333-4444" };
    const form = applyCnpjAnswer(typed, found);
    expect(form.name).toBe("Digitado");
    expect(form.phone).toBe("(21) 3333-4444");
    expect(form.tradeName).toBe("Exemplo");
  });

  it("changes nothing when the CNPJ was not found or the lookup failed", () => {
    const base = emptyCreateForm();
    expect(applyCnpjAnswer(base, { ...found, found: false })).toBe(base);
    expect(applyCnpjAnswer(base, null)).toBe(base);
  });
});
