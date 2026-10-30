import { GatewayConfigError } from '../errors.js';

/**
 * Write host allow-list (SNK-7 S2, SNK-3, SNK-6). Order writes may reach ONLY these two Sankhya Sandbox
 * hosts. The list is a constant in code on purpose: it is not configurable per environment, so a copied
 * `.env` can never point a write at another host (production included). Anything else is refused locally,
 * before any network I/O. Matching is exact on the normalized hostname; there is no suffix/prefix logic.
 */
export const SANDBOX_WRITE_HOSTS: readonly string[] = Object.freeze([
  'placfestas-teste.sankhyacloud.com.br',
  'api.sandbox.sankhya.com.br',
]);

export type WriteHostRefusal =
  | 'invalid_url'
  | 'not_https'
  | 'credentials_in_url'
  | 'port_not_allowed'
  | 'host_not_allowed';

export function writeHostRefusal(rawUrl: string): WriteHostRefusal | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'invalid_url';
  }
  if (url.protocol !== 'https:') return 'not_https';
  if (url.username !== '' || url.password !== '') return 'credentials_in_url';
  if (url.port !== '') return 'port_not_allowed';
  // `URL` lower-cases the host and converts IDN to punycode; a trailing dot is kept, so it is rejected
  // by the exact comparison below (never stripped silently).
  if (!SANDBOX_WRITE_HOSTS.includes(url.hostname)) return 'host_not_allowed';
  return null;
}

/**
 * Throws a `GatewayConfigError` (permanent, local, no network) unless the URL is exactly one of the
 * Sandbox write hosts. The message never echoes the URL.
 */
export function assertSandboxHost(rawUrl: string): void {
  const refusal = writeHostRefusal(rawUrl);
  if (refusal === null) return;
  throw new GatewayConfigError([
    `Refusing an order write: the target is not an allowed Sandbox write host (${refusal}). Writes are limited to the Sankhya Sandbox hosts fixed in code (SNK-3, SNK-6, SNK-7).`,
  ]);
}
