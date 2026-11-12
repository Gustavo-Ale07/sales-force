/**
 * Customer registration rules shared by server and mobile (D-AP / D-AQ / D-AR). Pure and deterministic: tax-document
 * validation, the idempotency key of a customer created in the Force, and the allow-list of fields a seller may edit.
 * No ERP names here: the mapping of these fields to the ERP lives in the Sankhya package.
 */

export type TaxDocumentKind = 'individual' | 'company';

/** Keeps digits only. */
export function normalizeTaxDocument(value: string): string {
  return value.replace(/\D/g, '');
}

function allSame(digits: string): boolean {
  return /^(\d)\1+$/.test(digits);
}

function checkDigit(digits: string, weights: readonly number[]): number {
  let sum = 0;
  for (let index = 0; index < weights.length; index += 1) sum += Number(digits[index]) * (weights[index] ?? 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

const CPF_WEIGHTS_1 = [10, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const CPF_WEIGHTS_2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const CNPJ_WEIGHTS_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const CNPJ_WEIGHTS_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;

export function isValidCpf(value: string): boolean {
  const digits = normalizeTaxDocument(value);
  if (digits.length !== 11 || allSame(digits)) return false;
  return checkDigit(digits, CPF_WEIGHTS_1) === Number(digits[9]) && checkDigit(digits, CPF_WEIGHTS_2) === Number(digits[10]);
}

export function isValidCnpj(value: string): boolean {
  const digits = normalizeTaxDocument(value);
  if (digits.length !== 14 || allSame(digits)) return false;
  return checkDigit(digits, CNPJ_WEIGHTS_1) === Number(digits[12]) && checkDigit(digits, CNPJ_WEIGHTS_2) === Number(digits[13]);
}

/** `null` when the document is not a valid CPF or CNPJ. */
export function taxDocumentKind(value: string): TaxDocumentKind | null {
  if (isValidCpf(value)) return 'individual';
  if (isValidCnpj(value)) return 'company';
  return null;
}

/** pt-BR mask; anything that is not 11 or 14 digits is returned unchanged. */
export function formatTaxDocument(value: string): string {
  const digits = normalizeTaxDocument(value);
  if (digits.length === 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (digits.length === 14) return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return value;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORIGIN_PREFIX = 'force:';

/** The value stored as the dedicated origin id of a customer created in the Force: `force:<uuid>` (42 characters). */
export function customerOriginKey(clientRequestId: string): string {
  if (!UUID.test(clientRequestId)) throw new Error('A customer origin key needs a UUID request id.');
  return `${ORIGIN_PREFIX}${clientRequestId.toLowerCase()}`;
}

/** The request id inside an origin key, or `null` when the value is not a Force origin key. */
export function parseCustomerOriginKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.startsWith(ORIGIN_PREFIX)) return null;
  const id = value.slice(ORIGIN_PREFIX.length);
  return UUID.test(id) ? id.toLowerCase() : null;
}

/** Fields a seller may change on an existing customer (D-AR 5). Anything else is rejected by the server. */
export const CUSTOMER_EDITABLE_FIELDS = ['phone', 'email', 'contacts', 'addresses', 'notes'] as const;
export type CustomerEditableField = (typeof CUSTOMER_EDITABLE_FIELDS)[number];

/** The keys of an edit request that are not on the allow-list (allow-list, never a deny-list). */
export function rejectedCustomerEditFields(change: Readonly<Record<string, unknown>>): string[] {
  const allowed: readonly string[] = CUSTOMER_EDITABLE_FIELDS;
  return Object.keys(change).filter((key) => !allowed.includes(key));
}
