import { formatDocument, titleCase } from "./display-format";

describe("display-format (same result as the site)", () => {
  it("title-cases a name the ERP stores in capitals and leaves mixed case alone", () => {
    expect(titleCase("DOCES DA VOVÓ LTDA")).toBe("Doces da Vovó LTDA");
    expect(titleCase("Padaria Central")).toBe("Padaria Central");
    expect(titleCase(null)).toBe("");
  });

  it("masks CNPJ and CPF and leaves anything else unchanged", () => {
    expect(formatDocument("12345678000190")).toBe("12.345.678/0001-90");
    expect(formatDocument("12345678901")).toBe("123.456.789-01");
    expect(formatDocument("ABC")).toBe("ABC");
    expect(formatDocument(null)).toBe("—");
  });
});
