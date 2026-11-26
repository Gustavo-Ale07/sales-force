import type { CnpjLookup } from "@salesforce/contracts";
import { describe, expect, it } from "vitest";
import { applyCnpjLookup } from "./customer-cnpj";
import { emptyCreateForm } from "./customer-form";

const answer: CnpjLookup = {
  found: true, cnpj: "11222333000181", legalName: "EMPRESA LTDA", tradeName: "Fantasia", postalCode: "01310100", street: "AV PAULISTA",
  number: "1000", complement: "SALA 1", neighborhood: "BELA VISTA", city: "SAO PAULO", uf: "SP", phone: "11999998888", email: "a@b.com", source: "brasilapi",
};

describe("applyCnpjLookup", () => {
  it("fills the empty fields with masked CEP and phone", () => {
    const form = applyCnpjLookup(emptyCreateForm(), answer);
    expect(form).toMatchObject({ name: "EMPRESA LTDA", tradeName: "Fantasia", postalCode: "01310-100", phone: "(11) 99999-8888", email: "a@b.com", number: "1000", complement: "SALA 1" });
  });

  it("never overwrites what the person typed", () => {
    const form = applyCnpjLookup({ ...emptyCreateForm(), name: "Meu nome", phone: "123" }, answer);
    expect(form.name).toBe("Meu nome");
    expect(form.phone).toBe("123");
  });

  it("changes nothing when the CNPJ was not found", () => {
    const empty = emptyCreateForm();
    expect(applyCnpjLookup(empty, { ...answer, found: false })).toBe(empty);
  });
});
