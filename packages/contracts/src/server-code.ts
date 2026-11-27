import { z } from 'zod';

/**
 * Server code (owner ruling 2026-11-27, replaces device approval). One code per environment:
 * `sf1.` + base64url(JSON `{ a: <API base URL, no trailing slash>, k: <32 random bytes, base64url> }`).
 * The client decodes it, uses `a` as the API base and sends ONLY `k` in the `X-Server-Code` header on every request.
 * The whole code never travels and is never logged; the server stores only SHA-256(k).
 *
 * Pure functions with no platform dependency (no Buffer, atob or TextDecoder): they run in the browser, in React Native and in Node.
 */
export const SERVER_CODE_HEADER = 'x-server-code';
export const SERVER_CODE_PREFIX = 'sf1.';

/** `k`: 32 bytes as unpadded base64url (43 characters). */
export const ServerCodeSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** `a`: an http(s) origin plus an optional path, without a trailing slash, query or fragment. */
export const ServerCodeApiUrlSchema = z
  .string()
  .max(300)
  .regex(/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~\-/]*[A-Za-z0-9._~-])?$/);

export const ServerCodePayloadSchema = z.strictObject({ a: ServerCodeApiUrlSchema, k: ServerCodeSecretSchema });
export type ServerCodePayload = z.infer<typeof ServerCodePayloadSchema>;


const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function bytesToBase64Url(bytes: readonly number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 !== undefined) out += ALPHABET[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 !== undefined) out += ALPHABET[b2 & 63];
  }
  return out;
}

function base64UrlToBytes(text: string): number[] | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of text) {
    buffer = (buffer << 6) | ALPHABET.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
      buffer &= (1 << bits) - 1;
    }
  }
  return bytes;
}

/** Builds the code. Throws when `a` or `k` is not valid (the server never produces an invalid code). */
export function encodeServerCode(payload: ServerCodePayload): string {
  const parsed = ServerCodePayloadSchema.parse(payload);
  const json = JSON.stringify({ a: parsed.a, k: parsed.k });
  const bytes: number[] = [];
  for (let i = 0; i < json.length; i += 1) bytes.push(json.charCodeAt(i)); // `a` and `k` are ASCII by their schemas
  return `${SERVER_CODE_PREFIX}${bytesToBase64Url(bytes)}`;
}

/** Decodes a pasted code; `null` for anything malformed (the caller shows only "Código inválido"). */
export function decodeServerCode(code: string): ServerCodePayload | null {
  const trimmed = code.trim();
  if (!trimmed.startsWith(SERVER_CODE_PREFIX)) return null;
  const bytes = base64UrlToBytes(trimmed.slice(SERVER_CODE_PREFIX.length));
  if (bytes === null || bytes.length === 0 || bytes.some((b) => b > 127)) return null;
  let value: unknown;
  try {
    value = JSON.parse(String.fromCharCode(...bytes));
  } catch {
    return null;
  }
  const parsed = ServerCodePayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** True when `text` is a well-formed `k` (what the server accepts from the header before comparing hashes). */
export function isServerCodeSecret(text: string): boolean {
  return ServerCodeSecretSchema.safeParse(text).success;
}
