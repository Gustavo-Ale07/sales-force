import { API_BASE_PATH } from "@salesforce/contracts";

export type ApiConfigResult =
  | { readonly ok: true; readonly baseUrl: string }
  | { readonly ok: false; readonly reason: "missing" | "invalid" };

/**
 * Turns the public `EXPO_PUBLIC_API_URL` value (an origin such as `http://192.168.0.10:3000` in development or
 * `https://api.example.com`) into the API base URL. It is public, non-secret configuration inlined by Expo at
 * bundle time; secrets never belong in the mobile app (P-22). Anything that is not a plain http(s) origin is
 * refused instead of guessed.
 */
export function resolveApiBaseUrl(rawOrigin: string | undefined): ApiConfigResult {
  const value = rawOrigin?.trim() ?? "";
  if (value.length === 0) return { ok: false, reason: "missing" };
  const match = /^(https?):\/\/([^/?#\s@]+)$/i.exec(value);
  if (!match) return { ok: false, reason: "invalid" };
  return { ok: true, baseUrl: `${(match[1] ?? "").toLowerCase()}://${match[2] ?? ""}${API_BASE_PATH}` };
}

// Expo replaces `process.env.EXPO_PUBLIC_*` literally at bundle time; keep this exact member expression.
export const apiConfig: ApiConfigResult = resolveApiBaseUrl(process.env.EXPO_PUBLIC_API_URL);
