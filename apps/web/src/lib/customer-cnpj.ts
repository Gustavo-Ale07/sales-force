import type { CnpjLookup } from "@salesforce/contracts";
import type { CreateForm } from "./customer-form";

/** CEP mask (00000-000). */
const maskCep = (digits: string) => (digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits);

const maskPhone = (digits: string) => {
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return digits;
};

/**
 * Fills the legal-entity form from a CNPJ answer. Only fields the person has not typed yet are filled (never overwrites typing);
 * the CEP then triggers the usual CEP lookup, which resolves city, neighborhood and street. A `found: false` answer changes nothing.
 */
export function applyCnpjLookup(form: CreateForm, answer: CnpjLookup): CreateForm {
  if (!answer.found) return form;
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
