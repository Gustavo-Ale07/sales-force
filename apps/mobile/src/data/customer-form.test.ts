import { ApiRequestError } from "./api";
import {
  addressProblems,
  applyPostalCode,
  buildCreateRequest,
  commercialProblems,
  identificationProblems,
  buildUpdateBody,
  createProblems,
  describeCustomerWriteError,
  editProblems,
  emptyCreateForm,
  emptyEditForm,
  hasCreateProblems,
  hasEditProblems,
  isUnknownOutcome,
} from "./customer-form";

const ID = "11111111-1111-4111-8111-111111111111";
const CNPJ = "11.222.333/0001-81";
const CPF = "529.982.247-25";

describe("edit body", () => {
  it("an empty form is refused with the shared text", () => {
    const problems = editProblems(emptyEditForm());
    expect(problems.empty).toBe("Preencha ao menos um campo para alterar.");
    expect(hasEditProblems(problems)).toBe(true);
  });

  it("sends only what was filled in, phone as digits, and nothing else", () => {
    const body = buildUpdateBody(ID, { ...emptyEditForm(), phone: "(11) 98888-7777", notes: "  ligar depois " });
    expect(body).toStrictEqual({ clientRequestId: ID, phone: "11988887777", notes: "ligar depois" });
  });

  it("limits: phone digits, e-mail, notes", () => {
    expect(editProblems({ ...emptyEditForm(), phone: "12345678901234" }).phone).toBe("Informe o telefone com até 13 dígitos.");
    expect(editProblems({ ...emptyEditForm(), email: "sem-arroba" }).email).toBe("Informe um e-mail válido.");
    expect(editProblems({ ...emptyEditForm(), notes: "x".repeat(4001) }).notes).toBe("As observações devem ter até 4000 caracteres.");
  });
});

describe("create request", () => {
  const base = { ...emptyCreateForm(), document: CNPJ, name: " Padaria ", stateRegistration: "123", cityCode: 3550308, cityLabel: "São Paulo - SP", priceTableCode: 5 };

  it("is strict: normalized document, trimmed text, one address with the city", () => {
    expect(hasCreateProblems(createProblems(base))).toBe(false);
    expect(buildCreateRequest({ ...base, tradeName: "Padoca", phone: "(11) 3333-2222", postalCode: "01310-100", number: "10", street: " Rua A ", neighborhood: "Centro" })).toStrictEqual({
      document: "11222333000181",
      name: "Padaria",
      tradeName: "Padoca",
      icmsClassification: "R",
      stateRegistration: "123",
      phone: "1133332222",
      email: null,
      notes: null,
      priceTableCode: 5,
      addresses: [
        { cityCode: 3550308, streetCode: 0, streetName: "Rua A", neighborhoodCode: 0, neighborhoodName: "Centro", number: "10", complement: null, postalCode: "01310100" },
      ],
    });
  });

  it("the price table is mandatory on screen 3", () => {
    expect(commercialProblems({ ...base, priceTableCode: null }).priceTableCode).toBe("Escolha a tabela de preço.");
    expect(commercialProblems(base).priceTableCode).toBeNull();
  });

  it("editing sends the price table only when it changed", () => {
    const same = emptyEditForm(5);
    expect(buildUpdateBody(ID, { ...same, phone: "11999990000" })).not.toHaveProperty("priceTableCode");
    expect(editProblems(same).empty).not.toBeNull();
    expect(buildUpdateBody(ID, { ...same, priceTableCode: 8 }).priceTableCode).toBe(8);
    expect(editProblems({ ...same, priceTableCode: 8 }).empty).toBeNull();
  });

  it("a picked suggestion goes by code, free text by name, never both", () => {
    const [address] = buildCreateRequest({ ...base, street: "Rua A", streetCode: 7, neighborhood: "Centro", neighborhoodCode: 3 }).addresses;
    expect(address).toMatchObject({ streetCode: 7, streetName: null, neighborhoodCode: 3, neighborhoodName: null });
  });

  it("screen 1 blocks an invalid document of the chosen kind and an empty name", () => {
    expect(identificationProblems({ ...base, document: "111.111.111-11", personKind: "individual" }).document).toBe("CPF inválido.");
    expect(identificationProblems({ ...base, document: CNPJ, personKind: "individual" }).document).toBe("CPF inválido.");
    expect(identificationProblems({ ...base, document: "" }).document).toBe("Informe o CNPJ.");
    expect(identificationProblems({ ...base, name: " " }).name).toBe("Informe a razão social ou o nome.");
  });

  it("company needs the state registration or Isento (sent as ISENTO)", () => {
    expect(createProblems({ ...base, stateRegistration: "" }).stateRegistration).toBe('Informe a inscrição estadual ou marque "Isento".');
    const exempt = { ...base, stateRegistration: "", exempt: true };
    expect(createProblems(exempt).stateRegistration).toBeNull();
    expect(buildCreateRequest(exempt).stateRegistration).toBe("ISENTO");
  });

  it("individual has no state registration or trade name: never an error, never sent", () => {
    const person = { ...base, personKind: "individual" as const, document: CPF, stateRegistration: "1", exempt: true, tradeName: "X" };
    expect(createProblems(person).stateRegistration).toBeNull();
    const request = buildCreateRequest(person);
    expect(request.stateRegistration).toBeNull();
    expect(request.tradeName).toBeNull();
  });

  it("screen 2 requires only the city; filled optional fields are checked", () => {
    expect(addressProblems(emptyCreateForm()).cityCode).toBe("Escolha a cidade.");
    expect(addressProblems(base)).toStrictEqual({ postalCode: null, cityCode: null, neighborhood: null, street: null, number: null, complement: null, phone: null, email: null });
    expect(addressProblems({ ...base, postalCode: "123" }).postalCode).toBe("O CEP deve ter 8 dígitos.");
    expect(addressProblems({ ...base, street: "x".repeat(61) }).street).toBe("A rua deve ter até 60 caracteres.");
  });

  it("a seller's customer carries no seller; a non-seller must choose one and it is sent", () => {
    expect(createProblems(base).sellerCode).toBeNull();
    expect(buildCreateRequest(base)).not.toHaveProperty("sellerCode");
    expect(commercialProblems(base, { sellerRequired: true }).sellerCode).toBe("Escolha o vendedor.");
    const chosen = { ...base, sellerCode: 12 };
    expect(commercialProblems(chosen, { sellerRequired: true }).sellerCode).toBeNull();
    expect(buildCreateRequest(chosen, { sellerRequired: true }).sellerCode).toBe(12);
    expect(buildCreateRequest(chosen)).not.toHaveProperty("sellerCode");
  });
});

describe("postal code", () => {
  const found = { found: true, street: "Avenida Paulista", neighborhood: "Bela Vista", city: "São Paulo", uf: "SP", cityCode: 3550308, neighborhoodCode: 5, streetCode: 0 };

  it("fills street, neighborhood and city; a zero code is free text", () => {
    const next = applyPostalCode(emptyCreateForm(), found);
    expect(next).toMatchObject({ street: "Avenida Paulista", streetCode: null, neighborhood: "Bela Vista", neighborhoodCode: 5, cityCode: 3550308, cityLabel: "São Paulo - SP" });
  });

  it("not found, offline or a city the ERP did not match changes nothing about the city", () => {
    const form = emptyCreateForm();
    expect(applyPostalCode(form, null)).toBe(form);
    expect(applyPostalCode(form, { ...found, found: false })).toBe(form);
    expect(applyPostalCode(form, { ...found, cityCode: null }).cityCode).toBeNull();
  });
});


describe("server answers", () => {
  const conflict = (reason: string) => new ApiRequestError({ status: 409, message: "x", reason });

  it.each([
    ["customer_edit_disabled", "A edição de cliente não está liberada nesta instalação. Nada foi alterado."],
    ["customer_edit_delivery_not_approved", "A edição de cliente ainda não pode ser enviada ao Sankhya. Nada foi alterado."],
    ["customer_write_disabled", "O cadastro de cliente não está liberado nesta instalação. Nada foi gravado."],
    ["document_already_registered", "Já existe um cliente com este CPF/CNPJ."],
  ])("409 %s", (reason, text) => {
    expect(describeCustomerWriteError(conflict(reason)).message).toBe(text);
  });

  it("400 unrecognized_keys names the fields in pt-BR", () => {
    const error = new ApiRequestError({ status: 400, message: "x", issues: [{ path: "document", code: "unrecognized_keys" }] });
    expect(describeCustomerWriteError(error).message).toBe("Estes campos não podem ser alterados: CPF/CNPJ.");
  });

  it("400 with a field problem keeps it on the field", () => {
    const error = new ApiRequestError({ status: 400, message: "x", issues: [{ path: "phone", code: "too_big", message: "Telefone longo" }] });
    expect(describeCustomerWriteError(error).fieldProblems).toStrictEqual({ phone: "Telefone longo" });
  });

  it("only network, 5xx and 429 keep the request id", () => {
    expect(isUnknownOutcome(new ApiRequestError({ status: 0, message: "x" }))).toBe(true);
    expect(isUnknownOutcome(new ApiRequestError({ status: 503, message: "x" }))).toBe(true);
    expect(isUnknownOutcome(new ApiRequestError({ status: 429, message: "x" }))).toBe(true);
    expect(isUnknownOutcome(conflict("customer_edit_disabled"))).toBe(false);
    expect(isUnknownOutcome(new ApiRequestError({ status: 400, message: "x" }))).toBe(false);
  });
});
