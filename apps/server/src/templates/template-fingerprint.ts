import { createHash } from 'node:crypto';
import type { TemplateItem } from '@salesforce/domain';

/**
 * SHA-256 (hex) of the canonical content of a create request, `clientRequestId` excluded: the customer,
 * the trimmed name and the lines with canonical quantities, in order. Two requests with the same id are the
 * same request only when this matches (idempotency, P-08); stored with the template.
 */
export function templateFingerprint(input: {
  readonly customerCode: number;
  readonly name: string;
  readonly items: readonly TemplateItem[];
}): string {
  const canonical = JSON.stringify([
    'v1',
    input.customerCode,
    input.name,
    input.items.map((item) => [item.productCode, item.quantity]),
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}
