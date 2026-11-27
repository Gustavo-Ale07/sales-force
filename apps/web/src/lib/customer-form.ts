import type { ApiSchema } from "@salesforce/contracts/client";
import { isValidCnpj, isValidCpf, normalizeTaxDocument, taxDocumentKind } from "@salesforce/domain";
import { describeApiError, type ErrorDescription } from "./error-message";
import { errorStatus, isHttpError } from "./http-error";

/**
 * Customer create/edit form rules (D-AP, D-AR). The limits mirror `packages/contracts/src/customer-write.ts`; the server stays
 * the authority and its answer is always shown. Anything the documents still leave open (contact column sizes, the catalogue of
 * streets and neighbourhoods, the names of the ICMS classes) is not decided here.
 */

export type UpdateCustomerBody = ApiSchema<"UpdateCustomerRequest">;
export type CreateCustomerBody = ApiSchema<"CreateCustomerRequest">;

export const LIMITS = {
  name: 100,
  tradeName: 100,
  stateRegistration: 16,
  phoneDigits: 13,
  email: 80,
  notes: 4000,
  addressName: 60,
  addressNumber: 6,
  addressComplement: 30,
} as const;

/** One ICMS classification as the server names it: the select shows `label`, never only the code. */
export interface IcmsOption {
  code: CreateCustomerBody["icmsClassification"];
  label: string;
}
export const DEFAULT_ICMS: IcmsOption["code"] = "R";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const digitsOf = (value: string) => value.replace(/\D/g, "");

export function phoneProblem(value: string): string | null {
  if (value.trim() === "") return null;
  const digits = digitsOf(value);
  if (digits.length === 0 || digits.length > LIMITS.phoneDigits) return `Informe o telefone com até ${LIMITS.phoneDigits} dígitos.`;
  return null;
}

export function emailProblem(value: string): string | null {
  const text = value.trim();
  if (text === "") return null;
  if (text.length > LIMITS.email) return `O e-mail deve ter até ${LIMITS.email} caracteres.`;
  return EMAIL_PATTERN.test(text) ? null : "Informe um e-mail válido.";
}

export function notesProblem(value: string): string | null {
  return value.trim().length > LIMITS.notes ? `As observações devem ter até ${LIMITS.notes} caracteres.` : null;
}

/* ---------- Edit ---------- */

export interface EditForm {
  /** The table chosen in the form; starts as the customer's current one. Sent only when it differs from `currentPriceTableCode`. */
  priceTableCode: number | null;
  currentPriceTableCode: number | null;
  phone: string;
  email: string;
  notes: string;
}

export interface EditProblems {
  phone: string | null;
  email: string | null;
  notes: string | null;
  /** Nothing filled in: the server refuses an empty change. */
  empty: string | null;
}

export const emptyEditForm = (currentPriceTableCode: number | null = null): EditForm => ({
  phone: "",
  email: "",
  notes: "",
  priceTableCode: currentPriceTableCode,
  currentPriceTableCode,
});

const priceTableChanged = (form: EditForm): boolean => form.priceTableCode !== null && form.priceTableCode !== form.currentPriceTableCode;

export function editProblems(form: EditForm): EditProblems {
  const touched = form.phone.trim() !== "" || form.email.trim() !== "" || form.notes.trim() !== "" || priceTableChanged(form);
  return {
    phone: phoneProblem(form.phone),
    email: emailProblem(form.email),
    notes: notesProblem(form.notes),
    empty: touched ? null : "Preencha ao menos um campo para alterar.",
  };
}

export function hasEditProblems(problems: EditProblems): boolean {
  return problems.empty !== null || problems.phone !== null || problems.email !== null || problems.notes !== null;
}

/**
 * Strict body of `PATCH /customers/{code}`: only what was filled in is sent (an empty field means "leave as is"; the form does not
 * clear stored values). Document, name, seller, type and credit are never part of it.
 */
export function buildUpdateBody(clientRequestId: string, form: EditForm): UpdateCustomerBody {
  return {
    clientRequestId,
    ...(form.phone.trim() === "" ? {} : { phone: digitsOf(form.phone) }),
    ...(form.email.trim() === "" ? {} : { email: form.email.trim() }),
    ...(form.notes.trim() === "" ? {} : { notes: form.notes.trim() }),
    ...(priceTableChanged(form) && form.priceTableCode !== null ? { priceTableCode: form.priceTableCode } : {}),
  };
}

/* ---------- Create ---------- */

export type PersonType = "F" | "J";

export interface CreateForm {
  /** Pessoa física (CPF) or jurídica (CNPJ): decides the document kind and whether trade name and state registration exist. */
  personType: PersonType;
  document: string;
  name: string;
  tradeName: string;
  icmsClassification: IcmsOption["code"];
  stateRegistration: string;
  exempt: boolean;
  /** Management profiles without an ERP seller code choose the owner seller; "" = not chosen. */
  sellerCode: string;
  phone: string;
  email: string;
  notes: string;
  /** Typed CEP (masked or not). */
  postalCode: string;
  /** ERP city code; null = not chosen (the city is mandatory). */
  cityCode: number | null;
  neighborhood: string;
  /** Set only while `neighborhood` is exactly an ERP neighborhood (picked from the suggestions or found by the CEP). */
  neighborhoodCode: number | null;
  street: string;
  streetCode: number | null;
  number: string;
  complement: string;
  /** ERP price table code (CODTAB); null = not chosen (mandatory). Starts as the installation default. */
  priceTableCode: number | null;
}

export const emptyCreateForm = (): CreateForm => ({
  personType: "J",
  document: "",
  name: "",
  tradeName: "",
  icmsClassification: DEFAULT_ICMS,
  stateRegistration: "",
  exempt: false,
  sellerCode: "",
  phone: "",
  email: "",
  notes: "",
  postalCode: "",
  cityCode: null,
  neighborhood: "",
  neighborhoodCode: null,
  street: "",
  streetCode: null,
  number: "",
  complement: "",
  priceTableCode: null,
});

export interface CreateProblems {
  document: string | null;
  name: string | null;
  tradeName: string | null;
  stateRegistration: string | null;
  cityCode: string | null;
  neighborhood: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  sellerCode: string | null;
  priceTableCode: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
}

/** The three screens of the registration, in order; each lists the problem keys it owns. */
export const CREATE_STEP_FIELDS: readonly (readonly (keyof CreateProblems)[])[] = [
  ["document", "name", "tradeName", "stateRegistration"],
  ["cityCode", "neighborhood", "street", "number", "complement", "phone", "email", "notes"],
  ["priceTableCode", "sellerCode"],
];

/** Form field (a key of `CreateProblems`) -> index of the screen that shows it. */
export function stepOfField(field: string): number {
  const index = CREATE_STEP_FIELDS.findIndex((fields) => (fields as readonly string[]).includes(field));
  return index < 0 ? 0 : index;
}

/** True when the typed document is a CPF (natural person): no state registration, no "Isento". */
export function isNaturalPerson(document: string): boolean {
  return taxDocumentKind(normalizeTaxDocument(document)) === "individual";
}

const tooLong = (value: string, max: number, label: string) => (value.trim().length > max ? `${label} deve ter até ${max} caracteres.` : null);

/** `sellerRequired`: the signed-in user has no ERP seller code (manager and equivalent) and must pick the owner seller. */
export function createProblems(form: CreateForm, sellerRequired = false): CreateProblems {
  const digits = normalizeTaxDocument(form.document);
  const natural = form.personType === "F";
  let document: string | null = null;
  if (digits === "") document = natural ? "Informe o CPF." : "Informe o CNPJ.";
  else if (natural ? !isValidCpf(digits) : !isValidCnpj(digits)) document = natural ? "CPF inválido." : "CNPJ inválido.";
  const ie = form.stateRegistration.trim();
  let stateRegistration: string | null = null;
  if (!natural && !form.exempt && ie === "") stateRegistration = 'Informe a inscrição estadual ou marque "Isento".';
  else if (!natural && !form.exempt && ie.length > LIMITS.stateRegistration) stateRegistration = `A inscrição estadual deve ter até ${LIMITS.stateRegistration} caracteres.`;
  return {
    document,
    name: form.name.trim() === "" ? "Informe a razão social ou o nome." : form.name.trim().length > LIMITS.name ? `O nome deve ter até ${LIMITS.name} caracteres.` : null,
    tradeName: natural ? null : tooLong(form.tradeName, LIMITS.tradeName, "O nome fantasia"),
    stateRegistration,
    cityCode: form.cityCode === null ? "Informe a cidade." : null,
    neighborhood: tooLong(form.neighborhood, LIMITS.addressName, "O bairro"),
    street: tooLong(form.street, LIMITS.addressName, "A rua"),
    number: tooLong(form.number, LIMITS.addressNumber, "O número"),
    complement: tooLong(form.complement, LIMITS.addressComplement, "O complemento"),
    sellerCode: sellerRequired && form.sellerCode === "" ? "Escolha o vendedor." : null,
    priceTableCode: form.priceTableCode === null ? "Escolha a tabela de preço." : null,
    phone: phoneProblem(form.phone),
    email: emailProblem(form.email),
    notes: notesProblem(form.notes),
  };
}

export function hasCreateProblems(problems: CreateProblems): boolean {
  return Object.values(problems).some((problem) => problem !== null);
}

/** Problems that stop the person on screen `step` (0-based): only that screen's fields count. */
export function stepHasProblems(problems: CreateProblems, step: number): boolean {
  return (CREATE_STEP_FIELDS[step] ?? []).some((field) => problems[field] !== null);
}

/** Lower case, no accents, trimmed: what suggestions and the city search compare. */
export function normalizeName(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").trim();
}

/** The code of the registry row whose name equals `text` (accent/case-insensitive); null when the text is free. */
export function matchCode(text: string, options: readonly { code: number; name: string }[]): number | null {
  const needle = normalizeName(text);
  if (needle === "") return null;
  return options.find((option) => normalizeName(option.name) === needle)?.code ?? null;
}

export function buildCreateBody(clientRequestId: string, form: CreateForm): CreateCustomerBody {
  // A natural person never carries a state registration nor a trade name, whatever was typed before the type changed.
  const natural = form.personType === "F";
  const ie = natural ? "" : form.exempt ? "ISENTO" : form.stateRegistration.trim();
  const tradeName = natural ? "" : form.tradeName.trim();
  const postalDigits = digitsOf(form.postalCode);
  const street = form.street.trim();
  const neighborhood = form.neighborhood.trim();
  const addresses: CreateCustomerBody["addresses"] =
    form.cityCode === null
      ? []
      : [
          {
            cityCode: form.cityCode,
            streetCode: form.streetCode ?? 0,
            neighborhoodCode: form.neighborhoodCode ?? 0,
            streetName: form.streetCode === null && street !== "" ? street : null,
            neighborhoodName: form.neighborhoodCode === null && neighborhood !== "" ? neighborhood : null,
            number: form.number.trim() === "" ? null : form.number.trim(),
            complement: form.complement.trim() === "" ? null : form.complement.trim(),
            postalCode: postalDigits.length === 8 ? postalDigits : null,
          },
        ];
  return {
    clientRequestId,
    ...(form.sellerCode === "" ? {} : { sellerCode: Number(form.sellerCode) }),
    ...(form.priceTableCode === null ? {} : { priceTableCode: form.priceTableCode }),
    document: normalizeTaxDocument(form.document),
    name: form.name.trim(),
    tradeName: tradeName === "" ? null : tradeName,
    icmsClassification: form.icmsClassification,
    stateRegistration: ie === "" ? null : ie,
    phone: form.phone.trim() === "" ? null : digitsOf(form.phone),
    email: form.email.trim() === "" ? null : form.email.trim(),
    notes: form.notes.trim() === "" ? null : form.notes.trim(),
    addresses,
  };
}

/* ---------- Server answers ---------- */

const FIELD_LABELS: Record<string, string> = {
  document: "CPF/CNPJ",
  name: "Nome",
  tradeName: "Nome fantasia",
  phone: "Telefone",
  email: "E-mail",
  notes: "Observações",
  contacts: "Contatos",
  addresses: "Endereços",
  stateRegistration: "Inscrição estadual",
  sellerCode: "Vendedor",
  priceTableCode: "Tabela de preço",
};

const REASON_TEXT: Record<string, string> = {
  customer_edit_disabled: "A edição de cliente não está liberada nesta instalação. Nada foi alterado.",
  customer_edit_delivery_not_approved: "A edição de cliente ainda não pode ser enviada ao Sankhya. Nada foi alterado.",
  customer_write_disabled: "O cadastro de cliente não está liberado nesta instalação. Nada foi gravado.",
  document_already_registered: "Já existe um cliente com este CPF/CNPJ.",
  customer_edit_field_not_supported: "Só telefone, e-mail e observações podem ser alterados. Nada foi alterado.",
  customer_update_in_progress: "Já existe uma alteração deste cliente em andamento. Aguarde o envio e tente de novo.",
};

/** Server field names that differ from the form's. */
const SERVER_FIELD_TO_FORM: Record<string, string> = { seller: "sellerCode" };
const ADDRESS_FIELD_TO_FORM: Record<string, string> = {
  cityCode: "cityCode",
  streetCode: "street",
  streetName: "street",
  neighborhoodCode: "neighborhood",
  neighborhoodName: "neighborhood",
  number: "number",
  complement: "complement",
  postalCode: "postalCode",
};

/** `addresses.0.cityCode` -> the form field `cityCode`; any other path -> its first segment (renamed when the form differs). */
export function formFieldOfServerPath(path: string): string {
  const parts = path.split(".");
  const head = parts[0] ?? path;
  if (head === "addresses") return ADDRESS_FIELD_TO_FORM[parts[2] ?? ""] ?? "cityCode";
  return SERVER_FIELD_TO_FORM[head] ?? head;
}

/** Field -> text map of a 422: `details.fields` (object) or, equivalently, the issue list. */
function serverFieldProblems(error: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (field: string, text: unknown) => {
    if (typeof text !== "string" || text === "") return;
    out[formFieldOfServerPath(field)] = text;
  };
  const fields = (error as { details?: { fields?: unknown } }).details?.fields;
  if (fields && typeof fields === "object") for (const [field, text] of Object.entries(fields)) put(field, text);
  for (const issue of (error as { issues?: readonly { path: string; message?: string }[] }).issues ?? []) put(issue.path, issue.message);
  return out;
}

export interface CustomerWriteFailure extends ErrorDescription {
  /** Problems the server attached to a field, keyed by the form field name. */
  fieldProblems: Record<string, string>;
}

/** Actionable pt-BR text for a refused or failed customer write; never shows the server's internal reason code. */
export function describeCustomerWriteError(error: unknown, fallbackTitle: string): CustomerWriteFailure {
  const status = errorStatus(error);
  const base = describeApiError(error, fallbackTitle);
  if (status === 0) return { ...base, title: fallbackTitle, description: "Sem conexão com o servidor. Nada foi alterado.", fieldProblems: {} };
  if (isHttpError(error) && status === 409) {
    const reason = (error as { reason?: string }).reason;
    const text = reason ? REASON_TEXT[reason] : undefined;
    if (text) return { ...base, title: fallbackTitle, description: text, fieldProblems: {} };
  }
  if (isHttpError(error) && status === 422) {
    // The server's own text, on the field it names; nothing was saved.
    const fieldProblems = serverFieldProblems(error);
    // `_` carries a text that belongs to no field: it stays in the alert.
    const description = fieldProblems._ ?? Object.values(fieldProblems)[0] ?? base.description;
    return { ...base, title: fallbackTitle, description, fieldProblems };
  }
  if (isHttpError(error) && status === 400) {
    const issues = (error as { issues?: readonly { path: string; message?: string; code: string }[] }).issues ?? [];
    const fieldProblems: Record<string, string> = {};
    const names: string[] = [];
    for (const issue of issues) {
      const field = formFieldOfServerPath(issue.path);
      const label = FIELD_LABELS[field];
      if (issue.code === "unrecognized_keys") {
        names.push(label ?? field);
        continue;
      }
      fieldProblems[field] = issue.message ?? "Valor inválido.";
    }
    const description =
      names.length > 0 ? `Estes campos não podem ser alterados: ${names.join(", ")}.` : "Corrija os campos destacados e tente novamente.";
    return { ...base, title: fallbackTitle, description, fieldProblems };
  }
  return { ...base, fieldProblems: {} };
}

/** The answer is definitive (the same request id must not be reused): everything except network, 5xx and 429. */
export function isUnknownOutcome(error: unknown): boolean {
  const status = errorStatus(error);
  return status === undefined || status === 0 || status >= 500 || status === 429;
}
