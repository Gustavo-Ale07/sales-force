import { API_BASE_PATH } from "@salesforce/contracts";

export type ApiConfigResult =
  | { readonly ok: true; readonly baseUrl: string }
  | { readonly ok: false; readonly reason: "missing" | "invalid" | "insecure" };

export interface ApiConfigOptions {
  /** Permit an `http:` origin. Development only: a release bundle needs `https:` (see `allowsCleartext`). */
  readonly allowCleartext: boolean;
}

/**
 * Cleartext HTTP is allowed in development (`__DEV__`) and, for a standalone DEV test build against a LAN API, only
 * through the explicit `EXPO_PUBLIC_ALLOW_CLEARTEXT=1` flag (the same opt-in that `plugins/with-dev-cleartext.js`
 * requires natively as `SF_ALLOW_CLEARTEXT=1`). A production/release build sets neither, so `http:` is refused.
 */
export function allowsCleartext(build: { readonly dev: boolean; readonly cleartextFlag: string | undefined }): boolean {
  return build.dev || build.cleartextFlag === "1";
}

/**
 * Turns the public `EXPO_PUBLIC_API_URL` value (an origin such as `http://192.168.0.10:3000` in development or
 * `https://api.example.com`) into the API base URL. It is public, non-secret configuration inlined by Expo at
 * bundle time; secrets never belong in the mobile app (P-22). Anything that is not a plain http(s) origin is
 * refused instead of guessed, and `http:` is refused unless cleartext is allowed (credentials and session cookies
 * must never travel unencrypted in a release build).
 */
export function resolveApiBaseUrl(rawOrigin: string | undefined, options: ApiConfigOptions = { allowCleartext: defaultAllowCleartext() }): ApiConfigResult {
  const value = rawOrigin?.trim() ?? "";
  if (value.length === 0) return { ok: false, reason: "missing" };
  const match = /^(https?):\/\/([^/?#\s@]+)$/i.exec(value);
  if (!match) return { ok: false, reason: "invalid" };
  const scheme = (match[1] ?? "").toLowerCase();
  if (scheme === "http" && !options.allowCleartext) return { ok: false, reason: "insecure" };
  return { ok: true, baseUrl: `${scheme}://${match[2] ?? ""}${API_BASE_PATH}` };
}

function defaultAllowCleartext(): boolean {
  // Expo replaces `process.env.EXPO_PUBLIC_*` literally at bundle time; keep this exact member expression.
  return allowsCleartext({ dev: __DEV__, cleartextFlag: process.env.EXPO_PUBLIC_ALLOW_CLEARTEXT });
}

// Expo replaces `process.env.EXPO_PUBLIC_*` literally at bundle time; keep this exact member expression.
export const apiConfig: ApiConfigResult = resolveApiBaseUrl(process.env.EXPO_PUBLIC_API_URL);
