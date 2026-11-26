import { createHash } from 'node:crypto';
import type { CreateCustomerRequest } from '@salesforce/contracts';
import { isQuantityOnStep, normalizeTaxDocument, validateQuantity } from '@salesforce/domain';

/** Pure row rules of the import (no I/O): what a quantity cell means, and the id of a customer row of one confirm. */

export const MAX_ORDER_LINES_PER_IMPORT = 500;

export type QuantityReading =
  | { readonly kind: 'blank' }
  | { readonly kind: 'invalid'; readonly reason: string }
  | { readonly kind: 'ok'; readonly value: string };

/** pt-BR input: "2", "2,5", "2.5". A thousands separator ("1.000,5") is refused, never guessed. */
export function readQuantity(text: string, step?: string | null): QuantityReading {
  const trimmed = text.trim();
  if (trimmed === '') return { kind: 'blank' };
  if (/[.,].*[.,]/.test(trimmed) || !/^\d+(?:[.,]\d+)?$/.test(trimmed)) return { kind: 'invalid', reason: 'Quantidade inválida.' };
  const parsed = validateQuantity(trimmed.replace(',', '.'));
  if (!parsed.ok) {
    return { kind: 'invalid', reason: parsed.error === 'not_positive' ? 'A quantidade deve ser maior que zero.' : 'Quantidade inválida.' };
  }
  if (step !== undefined && !isQuantityOnStep(parsed.value, step)) {
    return { kind: 'invalid', reason: 'Quantidade fora do múltiplo de venda do produto.' };
  }
  return { kind: 'ok', value: parsed.value };
}

/**
 * Stable per-row request id of a customer import: the same confirm (same `clientRequestId`) maps the same row to the same id,
 * so a replay never creates a customer twice. A UUID of version 5 shape derived from a hash.
 */
export function customerRowRequestId(confirmId: string, row: number): string {
  const hex = createHash('sha256').update(`import-customers:${confirmId}:${row}`).digest('hex');
  const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

export interface CustomerRowText {
  readonly document: string;
  readonly name: string;
  readonly tradeName: string;
  readonly phone: string;
  readonly email: string;
  readonly stateRegistration: string;
  readonly postalCode: string;
  readonly number: string;
  readonly complement: string;
  readonly sellerCode: string;
}

/** The unmasked digits that identify the customer; everything else in the cell is punctuation. */
export function documentDigits(text: string): string {
  return normalizeTaxDocument(text);
}

export function onlyDigits(text: string): string {
  return text.replace(/\D/g, '');
}

/** Request body of a customer row WITHOUT the address (the CEP lookup adds it). Empty cells become `null`. */
export function customerRequestOf(row: CustomerRowText, clientRequestId: string): Omit<CreateCustomerRequest, 'addresses'> {
  const sellerCode = Number(row.sellerCode);
  return {
    clientRequestId,
    document: row.document,
    name: row.name,
    tradeName: row.tradeName === '' ? null : row.tradeName,
    icmsClassification: 'R',
    stateRegistration: row.stateRegistration === '' ? null : row.stateRegistration,
    phone: row.phone === '' ? null : onlyDigits(row.phone),
    email: row.email === '' ? null : row.email,
    notes: null,
    ...(/^\d+$/.test(row.sellerCode) && sellerCode > 0 ? { sellerCode } : {}),
  };
}
