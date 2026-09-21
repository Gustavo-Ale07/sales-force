import { createHash } from 'node:crypto';

function normalize(value: unknown): unknown {
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object' && value !== null) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) sorted[key] = normalize((value as Record<string, unknown>)[key]);
    return sorted;
  }
  // `undefined` never reaches a hash: a column is either present with a value or `null`.
  return value === undefined ? null : value;
}

/**
 * Hash of the mapped content of a mirror row (`sha256:<hex>`). Keys are sorted and timestamps are
 * serialized as ISO instants, so the same content always yields the same hash. Sync metadata
 * (`syncedAt`, `deletedAt`, the hash itself) is not part of the content. Decimal columns arrive as
 * canonical decimal strings (see `canonicalPlainDecimal`), never as JavaScript numbers.
 */
export function contentHash(content: Readonly<Record<string, unknown>>): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(normalize(content))).digest('hex')}`;
}
