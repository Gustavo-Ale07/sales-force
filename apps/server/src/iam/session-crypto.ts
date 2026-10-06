import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { throttleAddress } from './client-address.js';

/** 256 bits from the CSPRNG, base64url (43 characters). The plain value only ever exists in the cookie. */
export const SESSION_TOKEN_BYTES = 32;

export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

/**
 * SHA-256 of the token. A plain fast hash is right here: the input already has 256 bits of entropy
 * (nothing to brute-force or precompute), and the lookup by hash must be exact.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function constantTimeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** A token as sent by a client is 43 base64url characters; anything else is rejected before hashing. */
export function looksLikeSessionToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

/**
 * Throttle key of a login name: hashed, so unknown names (attacker-chosen text) are never stored in clear. The
 * persisted prefix stays `email:` (legacy: rows already in `auth_throttle`, and tests, rely on that format).
 */
export function loginNameThrottleKey(normalizedLoginName: string): string {
  return `email:${createHash('sha256').update(normalizedLoginName, 'utf8').digest('hex')}`;
}

/** Throttle key of a client address: IPv4 as is, IPv6 aggregated by /64 (see `throttleAddress`). */
export function ipThrottleKey(address: string): string {
  return `ip:${throttleAddress(address)}`;
}

/** Throttle key of an external login name: hashed and namespaced apart from e-mail keys. */
export function externalLoginThrottleKey(normalizedLogin: string): string {
  return `extlogin:${createHash('sha256').update(normalizedLogin, 'utf8').digest('hex')}`;
}

/** Short correlation hash of a login name for audit rows (persisted under the legacy detail key `emailFingerprint`). */
export function loginNameFingerprint(normalizedLoginName: string): string {
  return createHash('sha256').update(normalizedLoginName, 'utf8').digest('hex').slice(0, 16);
}
