import { createHash } from 'node:crypto';
import { normalizeDecimalString } from '@salesforce/domain';

export interface FingerprintInput {
  readonly customerCode: number;
  readonly negotiationTypeCode: number | null;
  readonly notes: string | null;
  readonly items: readonly { readonly productCode: number; readonly quantity: string }[];
}

function canonicalQuantity(quantity: string): string {
  try {
    return normalizeDecimalString(quantity);
  } catch {
    // Not a decimal: the request fails validation later; the raw text still fingerprints deterministically.
    return quantity;
  }
}

/**
 * SHA-256 (hex) of the canonical content of a create request, `clientRequestId` excluded. Two
 * requests with the same id are the same request only when this value matches ("2" and "2.0" are the
 * same quantity; the order of the lines is part of the content). Stored with the order so a replay
 * is recognized by content, never by guessing (idempotency, P-08).
 */
export function orderFingerprint(input: FingerprintInput): string {
  const canonical = JSON.stringify([
    'v1',
    input.customerCode,
    input.negotiationTypeCode,
    input.notes,
    input.items.map((item) => [item.productCode, canonicalQuantity(item.quantity)]),
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}
