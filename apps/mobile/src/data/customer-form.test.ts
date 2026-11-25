import { ApiRequestError } from "./api";
import {
  buildCreateRequest,
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

  it("contacts need a name and carry null for empty optional fields", () => {
    const form = { ...emptyEditForm(), contacts: [{ key: "a", name: " ", role: "", phone: "", email: "" }] };
    expect(editProblems(form).contacts[0]?.name).toBe("Informe o nome do contato.");
    const ok = { ...emptyEditForm(), contacts: [{ key: "a", name: "Ana", role: "", phone: "(11) 5555-4444", email: "" }] };
    expect(hasEditProblems(editProblems(ok))).toBe(false);
    expect(buildUpdateBody(ID, ok).contacts).toStrictEqual([{ name: "Ana", role: null, phone: "1155554444", email: null }]);
  });

  it("limits: phone digits, e-mail, notes", () => {
    expect(editProblems({ ...emptyEditForm(), phone: "12345678901234" }).phone).toBe("Informe o telefone com até 13 dígitos.");
    expect(editProblems({ ...emptyEditForm(), email: "sem-arroba" }).email).toBe("Informe um e-mail válido.");
    expect(editProblems({ ...emptyEditForm(), notes: "x".repeat(4001) }).notes).toBe("As observações devem ter até 4000 caracteres.");
  });
});

describe("create request", () => {
  const base = { ...emptyCreateForm(), document: CNPJ, name: " Padaria ", stateRegistration: "123" };

  it("is strict: normalized document, trimmed text, no addresses", () => {
    expect(hasCreateProblems(createProblems(base))).toBe(false);
    expect(buildCreateRequest({ ...base, tradeName: "Padoca", phone: "(11) 3333-2222" })).toStrictEqual({
      document: "11222333000181",
      name: "Padaria",
      tradeName: "Padoca",
      icmsClassification: "R",
      stateRegistration: "123",
      phone: "1133332222",
      email: null,
      notes: null,
      addresses: [],
    });
  });

  it("rejects an invalid document and an empty one", () => {
    expect(createProblems({ ...base, document: "111.111.111-11" }).document).toBe("CPF ou CNPJ inválido.");
    expect(createProblems({ ...base, document: "" }).document).toBe("Informe o CPF ou CNPJ.");
  });

  it("company needs the state registration or Isento (sent as ISENTO)", () => {
    expect(createProblems({ ...base, stateRegistration: "" }).stateRegistration).toBe('Informe a inscrição estadual ou marque "Isento".');
    const exempt = { ...base, stateRegistration: "", exempt: true };
    expect(createProblems(exempt).stateRegistration).toBeNull();
    expect(buildCreateRequest(exempt).stateRegistration).toBe("ISENTO");
  });

  it("individual has no state registration", () => {
    expect(createProblems({ ...base, document: CPF, stateRegistration: "1" }).stateRegistration).toBe("Pessoa física não tem inscrição estadual.");
    expect(createProblems({ ...base, document: CPF, stateRegistration: "" }).stateRegistration).toBeNull();
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
