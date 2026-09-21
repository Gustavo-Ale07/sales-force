import { randomBytes } from 'node:crypto';

/**
 * UUIDv7 (RFC 9562), generated in the application, never by PostgreSQL (DATA-1). 48-bit millisecond
 * timestamp, version 7, variant 10, 74 random bits. Ids are opaque: business logic never orders by id.
 */
export function uuidv7(now: number = Date.now(), random: (size: number) => Uint8Array = randomBytes): string {
  const bytes = Uint8Array.from(random(16));
  let timestamp = Math.floor(now);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp % 256;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
