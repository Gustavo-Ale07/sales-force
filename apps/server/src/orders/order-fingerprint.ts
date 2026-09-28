import { createHash } from 'node:crypto';
import { normalizeDecimalString } from '@salesforce/domain';

export interface FingerprintInput {
  readonly customerCode: number;
  readonly negotiationTypeCode: number | null;
  readonly notes: string | null;
  readonly items: readonly { readonly productCode: number; readonly quantity: string; readonly discountPercent?: string | undefined }[];
}

function canonicalQuantity(quantity: string): string {
  try {
    return normalizeDecimalString(quantity);
  } catch {
    // Not a decimal: the request fails validation later; the raw text still fingerprints deterministically.
    return quantity;
  }
}

function canonicalDiscount(discountPercent: string | undefined): string {
  return discountPercent === undefined ? '0' : canonicalQuantity(discountPercent);
}

/**
 * SHA-256 (hex) of the canonical content of a create request, `clientRequestId` excluded. Two
 * requests with the same id are the same request only when this value matches ("2" and "2.0" are the
 * same quantity; the order of the lines is part of the content). Stored with the order so a replay
 * is recognized by content, never by guessing (idempotency, P-08).
 */
export function orderFingerprint(input: FingerprintInput): string {
  // A request without any discount keeps the original 'v1' content, so fingerprints stored before discounts existed still match a replay.
  const discounted = input.items.some((item) => canonicalDiscount(item.discountPercent) !== '0');
  const canonical = JSON.stringify([
    discounted ? 'v2' : 'v1',
    input.customerCode,
    input.negotiationTypeCode,
    input.notes,
    input.items.map((item) =>
      discounted
        ? [item.productCode, canonicalQuantity(item.quantity), canonicalDiscount(item.discountPercent)]
        : [item.productCode, canonicalQuantity(item.quantity)],
    ),
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}
