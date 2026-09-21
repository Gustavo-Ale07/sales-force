/**
 * CSRF defence for cookie-authenticated requests (security model §3.2, §9). Layers:
 *   1. the session cookie is `SameSite=Lax` (browsers do not attach it to cross-site POST/PUT/DELETE);
 *   2. this check on every state-changing request: the `Origin` header must be an allowed origin;
 *      without `Origin`, browser Fetch Metadata (`Sec-Fetch-Site`) must say same-origin (or direct
 *      navigation);
 *   3. no state change is reachable with GET (the route registry only maps reads to GET).
 * A request with neither header is not from a browser (curl, mobile app, server-to-server): a forged
 * cross-site page cannot produce it, so it is accepted here and still needs a valid session.
 * Pure: no framework types.
 */

export interface CsrfInput {
  readonly method: string;
  readonly origin: string | undefined;
  readonly secFetchSite: string | undefined;
}

export type CsrfVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'origin_not_allowed' | 'cross_site_fetch' };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function checkCsrf(input: CsrfInput, allowedOrigins: readonly string[]): CsrfVerdict {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return { ok: true };

  if (input.origin !== undefined) {
    // `Origin: null` (sandboxed frames, redirects across origins) never matches an allowed origin.
    return allowedOrigins.includes(input.origin) ? { ok: true } : { ok: false, reason: 'origin_not_allowed' };
  }
  if (input.secFetchSite !== undefined) {
    return input.secFetchSite === 'same-origin' || input.secFetchSite === 'none'
      ? { ok: true }
      : { ok: false, reason: 'cross_site_fetch' };
  }
  return { ok: true };
}
