import { isValidCnpj, isValidCpf, normalizeTaxDocument, taxDocumentKind } from "@salesforce/domain";
import { ApiRequestError } from "./api";

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

export const ICMS_OPTIONS = ["C", "I", "P", "R", "T", "X"] as const;
export type IcmsOption = (typeof ICMS_OPTIONS)[number];
export const DEFAULT_ICMS: IcmsOption = "R";

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
}

export const emptyEditForm = (): EditForm => ({ phone: "", email: "", notes: "" });

export function editProblems(form: EditForm): EditProblems {
  const touched = form.phone.trim() !== "" || form.email.trim() !== "" || form.notes.trim() !== "";
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
  };
}

/* ---------- Create ---------- */

export interface CreateForm {
  document: string;
  name: string;
  tradeName: string;
  icmsClassification: IcmsOption;
  stateRegistration: string;
  exempt: boolean;
  phone: string;
  email: string;
  notes: string;
}

export const emptyCreateForm = (): CreateForm => ({
  document: "",
  name: "",
  tradeName: "",
  icmsClassification: DEFAULT_ICMS,
  stateRegistration: "",
  exempt: false,
  phone: "",
  email: "",
  notes: "",
});

export interface CreateProblems {
  document: string | null;
  name: string | null;
  tradeName: string | null;
  stateRegistration: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
}

export function createProblems(form: CreateForm): CreateProblems {
  const digits = normalizeTaxDocument(form.document);
  const kind = taxDocumentKind(digits);
  let document: string | null = null;
  if (digits === "") document = "Informe o CPF ou CNPJ.";
  else if (kind === null || !(kind === "individual" ? isValidCpf(digits) : isValidCnpj(digits))) document = "CPF ou CNPJ inválido.";
  const ie = form.stateRegistration.trim();
  let stateRegistration: string | null = null;
  if (kind === "company" && !form.exempt && ie === "") stateRegistration = 'Informe a inscrição estadual ou marque "Isento".';
  else if (kind === "individual" && (ie !== "" || form.exempt)) stateRegistration = "Pessoa física não tem inscrição estadual.";
  else if (ie.length > LIMITS.stateRegistration) stateRegistration = `A inscrição estadual deve ter até ${LIMITS.stateRegistration} caracteres.`;
  return {
    document,
    name: form.name.trim() === "" ? "Informe a razão social ou o nome." : form.name.trim().length > LIMITS.name ? `O nome deve ter até ${LIMITS.name} caracteres.` : null,
    tradeName: form.tradeName.trim().length > LIMITS.tradeName ? `O nome fantasia deve ter até ${LIMITS.tradeName} caracteres.` : null,
    stateRegistration,
    phone: phoneProblem(form.phone),
    email: emailProblem(form.email),
    notes: notesProblem(form.notes),
  };
}

export function hasCreateProblems(problems: CreateProblems): boolean {
  return Object.values(problems).some((problem) => problem !== null);
}

/** The creation request (same shape as the pending customer the sync engine delivers); no addresses in this lote. */
export interface CreateCustomerRequest {
  document: string;
  name: string;
  tradeName: string | null;
  icmsClassification: IcmsOption;
  stateRegistration: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  addresses: [];
  /** The refused registration this one corrects ("Precisa de correção"); sent with the creation. */
  correctsRegistrationId?: string;
}

export function buildCreateRequest(form: CreateForm, correctsRegistrationId?: string): CreateCustomerRequest {
  const ie = form.exempt ? "ISENTO" : form.stateRegistration.trim();
  return {
    document: normalizeTaxDocument(form.document),
    name: form.name.trim(),
    tradeName: form.tradeName.trim() === "" ? null : form.tradeName.trim(),
    icmsClassification: form.icmsClassification,
    stateRegistration: ie === "" ? null : ie,
    phone: form.phone.trim() === "" ? null : digitsOf(form.phone),
    email: form.email.trim() === "" ? null : form.email.trim(),
    notes: form.notes.trim() === "" ? null : form.notes.trim(),
    addresses: [],
    ...(correctsRegistrationId === undefined ? {} : { correctsRegistrationId }),
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
