import type { CreateForm } from "./customer-form";

/** What the server answers for a CNPJ (`GET /customers/cnpj/{cnpj}`); `found: false` for any failure. */
export interface CnpjAnswer {
  readonly found: boolean;
  readonly legalName: string | null;
  readonly tradeName: string | null;
  readonly postalCode: string | null;
  readonly number: string | null;
  readonly complement: string | null;
  readonly phone: string | null;
  readonly email: string | null;
}

const maskCep = (digits: string) => (digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits);
const maskPhone = (digits: string) => {
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return digits;
};

/** Fills a legal-entity form from a CNPJ answer: only empty fields (never overwrites typing); not found changes nothing. */
export function applyCnpjAnswer(form: CreateForm, answer: CnpjAnswer | null): CreateForm {
  if (answer === null || !answer.found) return form;
  const blank = (value: string) => value.trim() === "";
  return {
    ...form,
    name: blank(form.name) ? (answer.legalName ?? form.name) : form.name,
    tradeName: blank(form.tradeName) ? (answer.tradeName ?? form.tradeName) : form.tradeName,
    phone: blank(form.phone) && answer.phone !== null ? maskPhone(answer.phone) : form.phone,
    email: blank(form.email) ? (answer.email ?? form.email) : form.email,
    postalCode: blank(form.postalCode) && answer.postalCode !== null ? maskCep(answer.postalCode) : form.postalCode,
    number: blank(form.number) ? (answer.number ?? form.number) : form.number,
    complement: blank(form.complement) ? (answer.complement ?? form.complement) : form.complement,
  };
}
