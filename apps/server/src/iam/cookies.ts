import { API_BASE_PATH, SESSION_COOKIE_NAME } from '@salesforce/contracts';

export interface SessionCookieOptions {
  /** `Secure` attribute: on everywhere except local development. */
  readonly secure: boolean;
}

/** Reads one cookie from a `Cookie` request header. Returns the first occurrence, undecoded. */
export function readCookie(header: string | string[] | undefined, name: string): string | undefined {
  const raw = Array.isArray(header) ? header.join(';') : header;
  if (raw === undefined) return undefined;
  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

function attributes(options: SessionCookieOptions): string[] {
  // HttpOnly: no script access. SameSite=Lax: not sent on cross-site sub-requests or POSTs (first
  // CSRF layer; the Origin check in `csrf.ts` is the second). Path: the API only, not static assets.
  const list = ['Path=' + API_BASE_PATH, 'HttpOnly', 'SameSite=Lax'];
  if (options.secure) list.push('Secure');
  return list;
}

/** `Set-Cookie` value carrying the session token until `expiresAt`. */
export function serializeSessionCookie(
  token: string,
  expiresAt: Date,
  now: Date,
  options: SessionCookieOptions,
): string {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
  return [`${SESSION_COOKIE_NAME}=${token}`, `Max-Age=${maxAge}`, ...attributes(options)].join('; ');
}

/** `Set-Cookie` value that removes the session cookie in the browser. */
export function serializeClearedSessionCookie(options: SessionCookieOptions): string {
  return [`${SESSION_COOKIE_NAME}=`, 'Max-Age=0', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT', ...attributes(options)].join(
    '; ',
  );
}
