import { isValidCnpj, isValidCpf, normalizeTaxDocument } from "@salesforce/domain";
import { ApiRequestError } from "./api";
import type { PendingCustomerRequest } from "@salesforce/mobile-db";

/**
 * Customer create/edit form rules (D-AP, D-AR), the same limits, labels and texts as the site (`apps/web/src/lib/customer-form.ts`, PAR-1).
 * The server stays the authority and its answer is always shown.
 */

export const LIMITS = {
  name: 100,
  tradeName: 100,
  stateRegistration: 16,
  phoneDigits: 13,
  email: 80,
  notes: 4000,
} as const;

export type IcmsOption = "C" | "I" | "P" | "R" | "T" | "X";
export const DEFAULT_ICMS: IcmsOption = "R";

/** One entry of the server's list of ICMS classifications: the NAME is what the seller sees, never only the letter. */
export interface IcmsClassificationOption {
  readonly code: IcmsOption;
  readonly label: string;
}

/** An active seller a manager can link a new customer to. */
export interface SellerChoice {
  readonly code: number;
  readonly name: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const digitsOf = (value: string): string => value.replace(/\D/g, "");

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

/** Strict body of `PATCH /customers/{code}`. */
export interface UpdateCustomerBody {
  clientRequestId: string;
  phone?: string;
  email?: string;
  notes?: string;
  priceTableCode?: number;
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
  return (
    problems.empty !== null ||
    problems.phone !== null ||
    problems.email !== null ||
    problems.notes !== null
  );
}

/** Only what was filled in is sent; an empty field means "leave as is". Document, name, seller, type and credit are never part of it. */
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

export type PersonKind = "individual" | "company";

export const ADDRESS_LIMITS = { number: 6, complement: 30, addressName: 60 } as const;

export interface CreateForm {
  personKind: PersonKind;
  document: string;
  name: string;
  tradeName: string;
  icmsClassification: IcmsOption;
  stateRegistration: string;
  exempt: boolean;
  postalCode: string;
  /** ERP city code; mandatory. Chosen in the picker or filled by the postal code. */
  cityCode: number | null;
  /** "Nome - UF" of the chosen city (display only). */
  cityLabel: string;
  neighborhood: string;
  /** Set only while the text is a suggestion the seller picked (or the postal code matched); typing free text clears it. */
  neighborhoodCode: number | null;
  street: string;
  streetCode: number | null;
  number: string;
  complement: string;
  phone: string;
  email: string;
  /** Only chosen by a user who is not a seller (manager and equivalent); a seller's customer is linked to them by the server. */
  sellerCode: number | null;
  /** ERP price table (CODTAB); null = not chosen (mandatory). Starts as the installation default. */
  priceTableCode: number | null;
}

export const emptyCreateForm = (): CreateForm => ({
  personKind: "company",
  document: "",
  name: "",
  tradeName: "",
  icmsClassification: DEFAULT_ICMS,
  stateRegistration: "",
  exempt: false,
  postalCode: "",
  cityCode: null,
  cityLabel: "",
  neighborhood: "",
  neighborhoodCode: null,
  street: "",
  streetCode: null,
  number: "",
  complement: "",
  phone: "",
  email: "",
  sellerCode: null,
  priceTableCode: null,
});

export interface CreateProblems {
  sellerCode: string | null;
  priceTableCode: string | null;
  document: string | null;
  name: string | null;
  tradeName: string | null;
  stateRegistration: string | null;
  postalCode: string | null;
  cityCode: string | null;
  neighborhood: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  phone: string | null;
  email: string | null;
}

const tooLong = (value: string, max: number, text: string): string | null => (value.trim().length > max ? `${text} deve ter até ${max} caracteres.` : null);

/** Screen 1 (Identificação): only what the ERP requires blocks (valid document of the chosen kind, name); the rest is checked for size. */
export function identificationProblems(form: CreateForm): Pick<CreateProblems, "document" | "name" | "tradeName" | "stateRegistration"> {
  const digits = normalizeTaxDocument(form.document);
  let document: string | null = null;
  if (digits === "") document = form.personKind === "individual" ? "Informe o CPF." : "Informe o CNPJ.";
  else if (form.personKind === "individual" ? !isValidCpf(digits) : !isValidCnpj(digits)) document = form.personKind === "individual" ? "CPF inválido." : "CNPJ inválido.";
  return {
    document,
    name: form.name.trim() === "" ? "Informe a razão social ou o nome." : tooLong(form.name, LIMITS.name, "O nome"),
    tradeName: tooLong(form.tradeName, LIMITS.tradeName, "O nome fantasia"),
    stateRegistration:
      form.personKind === "company" && !form.exempt
        ? form.stateRegistration.trim() === ""
          ? 'Informe a inscrição estadual ou marque "Isento".'
          : tooLong(form.stateRegistration, LIMITS.stateRegistration, "A inscrição estadual")
        : null,
  };
}

/** Screen 2 (Endereço e contato): only the city blocks; filled optional fields are checked for shape and size. */
export function addressProblems(form: CreateForm): Pick<CreateProblems, "postalCode" | "cityCode" | "neighborhood" | "street" | "number" | "complement" | "phone" | "email"> {
  const cep = digitsOf(form.postalCode);
  return {
    postalCode: form.postalCode.trim() !== "" && cep.length !== 8 ? "O CEP deve ter 8 dígitos." : null,
    cityCode: form.cityCode === null ? "Escolha a cidade." : null,
    neighborhood: tooLong(form.neighborhood, ADDRESS_LIMITS.addressName, "O bairro"),
    street: tooLong(form.street, ADDRESS_LIMITS.addressName, "A rua"),
    number: tooLong(form.number, ADDRESS_LIMITS.number, "O número"),
    complement: tooLong(form.complement, ADDRESS_LIMITS.complement, "O complemento"),
    phone: phoneProblem(form.phone),
    email: emailProblem(form.email),
  };
}

/** Screen 3 (Comercial): `sellerRequired` = the signed-in user is not a seller, so the form must carry the seller. */
export function commercialProblems(form: CreateForm, options: { readonly sellerRequired?: boolean } = {}): Pick<CreateProblems, "sellerCode" | "priceTableCode"> {
  return {
    sellerCode: options.sellerRequired === true && form.sellerCode === null ? "Escolha o vendedor." : null,
    priceTableCode: form.priceTableCode === null ? "Escolha a tabela de preço." : null,
  };
}

export function createProblems(form: CreateForm, options: { readonly sellerRequired?: boolean } = {}): CreateProblems {
  return { ...identificationProblems(form), ...addressProblems(form), ...commercialProblems(form, options) };
}

export function hasProblems(problems: Readonly<Record<string, string | null>>): boolean {
  return Object.values(problems).some((problem) => problem !== null);
}

export function hasCreateProblems(problems: CreateProblems): boolean {
  return hasProblems(problems as unknown as Record<string, string | null>);
}

/** What the server answered for a postal code (`GET /customers/postal-code/{cep}`), only the fields the form uses. */
export interface PostalCodeAnswer {
  readonly found: boolean;
  readonly street: string | null;
  readonly neighborhood: string | null;
  readonly city: string | null;
  readonly uf: string | null;
  readonly cityCode: number | null;
  readonly neighborhoodCode: number | null;
  readonly streetCode: number | null;
}

/**
 * Fills street, neighborhood and city from a found postal code; the seller can correct any of them by hand afterwards. A not-found
 * answer changes nothing. A city the ERP did not match (`cityCode` null) is not filled: the city stays mandatory and is picked by hand.
 */
export function applyPostalCode(form: CreateForm, answer: PostalCodeAnswer | null): CreateForm {
  if (answer === null || !answer.found) return form;
  const next: CreateForm = { ...form };
  if (answer.street !== null && answer.street.trim() !== "") {
    next.street = answer.street.trim().slice(0, ADDRESS_LIMITS.addressName);
    next.streetCode = answer.streetCode !== null && answer.streetCode > 0 ? answer.streetCode : null;
  }
  if (answer.neighborhood !== null && answer.neighborhood.trim() !== "") {
    next.neighborhood = answer.neighborhood.trim().slice(0, ADDRESS_LIMITS.addressName);
    next.neighborhoodCode = answer.neighborhoodCode !== null && answer.neighborhoodCode > 0 ? answer.neighborhoodCode : null;
  }
  if (answer.cityCode !== null && answer.cityCode > 0) {
    next.cityCode = answer.cityCode;
    next.cityLabel = answer.city === null ? "" : answer.uf === null ? answer.city : `${answer.city} - ${answer.uf}`;
  }
  return next;
}

/** The creation request (same shape as the pending customer the sync engine delivers). */
export interface CreateCustomerRequest {
  document: string;
  name: string;
  tradeName: string | null;
  icmsClassification: IcmsOption;
  stateRegistration: string | null;
  phone: string | null;
  email: string | null;
  notes: null;
  addresses: PendingCustomerRequest["addresses"][number][];
  /** Manager and equivalent only: the seller that owns the customer. Absent for a seller (linked automatically). */
  sellerCode?: number;
  priceTableCode?: number;
}

const orNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());

export function buildCreateRequest(form: CreateForm, options: { readonly sellerRequired?: boolean } = {}): CreateCustomerRequest {
  const company = form.personKind === "company";
  const ie = !company ? "" : form.exempt ? "ISENTO" : form.stateRegistration.trim();
  const cep = digitsOf(form.postalCode);
  // A suggestion the seller picked goes by its code; free text goes by name (the server matches or creates it). Never both.
  const street = form.streetCode !== null ? { streetCode: form.streetCode, streetName: null } : { streetCode: 0, streetName: orNull(form.street) };
  const neighborhood = form.neighborhoodCode !== null ? { neighborhoodCode: form.neighborhoodCode, neighborhoodName: null } : { neighborhoodCode: 0, neighborhoodName: orNull(form.neighborhood) };
  return {
    document: normalizeTaxDocument(form.document),
    name: form.name.trim(),
    tradeName: company ? orNull(form.tradeName) : null,
    icmsClassification: form.icmsClassification,
    stateRegistration: ie === "" ? null : ie,
    phone: form.phone.trim() === "" ? null : digitsOf(form.phone),
    email: orNull(form.email),
    notes: null,
    addresses: form.cityCode === null ? [] : [{ cityCode: form.cityCode, ...street, ...neighborhood, number: orNull(form.number), complement: orNull(form.complement), postalCode: cep.length === 8 ? cep : null }],
    ...(options.sellerRequired === true && form.sellerCode !== null ? { sellerCode: form.sellerCode } : {}),
    ...(form.priceTableCode === null ? {} : { priceTableCode: form.priceTableCode }),
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

export interface CustomerWriteFailure {
  message: string;
  /** Problems the server attached to a field, keyed by the form field name. */
  fieldProblems: Record<string, string>;
}

/** Actionable pt-BR text for a refused or failed customer write; never shows the server's internal reason code. */
export function describeCustomerWriteError(error: unknown): CustomerWriteFailure {
  if (error instanceof ApiRequestError) {
    if (error.status === 409 && error.reason !== undefined) {
      const text = REASON_TEXT[error.reason];
      if (text !== undefined) return { message: text, fieldProblems: {} };
    }
    if (error.status === 400) {
      const fieldProblems: Record<string, string> = {};
      const names: string[] = [];
      for (const issue of error.issues) {
        const field = issue.path.split(".")[0] ?? issue.path;
        if (issue.code === "unrecognized_keys") {
          names.push(FIELD_LABELS[field] ?? field);
          continue;
        }
        fieldProblems[field] = issue.message ?? "Valor inválido.";
      }
      return {
        message: names.length > 0 ? `Estes campos não podem ser alterados: ${names.join(", ")}.` : "Corrija os campos destacados e tente novamente.",
        fieldProblems,
      };
    }
    if (error.status === 0) return { message: "Sem conexão com o servidor. Nada foi alterado.", fieldProblems: {} };
    return { message: error.message, fieldProblems: {} };
  }
  return { message: "Não foi possível concluir. Tente de novo.", fieldProblems: {} };
}

/** The answer is NOT definitive (the same request id must be reused): network, 5xx and 429. Everything else is final. */
export function isUnknownOutcome(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) return true;
  return error.status === 0 || error.status >= 500 || error.status === 429;
}
