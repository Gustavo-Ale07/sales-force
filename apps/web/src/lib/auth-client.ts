import { queryOptions } from "@tanstack/react-query";

/**
 * Authentication boundary of the web app.
 *
 * The UI only depends on this interface. The real implementation will call the generated API client
 * (`POST /auth/login`, `POST /auth/logout`, `GET /auth/session`, same origin, HttpOnly session cookie) and map the
 * contract types to these shapes. No token or session data is ever stored in browser storage.
 * `AuthUser` is a UI-side projection: it is replaced by the contract type once `packages/contracts` exposes it.
 */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  /** Human-readable profile name (pt-BR), when the server provides one. */
  roleLabel?: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export type LoginFailureReason =
  /** Wrong e-mail or password (same message whether or not the e-mail exists). */
  | "invalid_credentials"
  /** Progressive lockout after repeated failures. */
  | "locked"
  | "rate_limited"
  /** The profile may not use the web channel (enforced by the server). */
  | "channel_forbidden"
  /** Network failure, 5xx or auth service not wired. */
  | "unavailable";

export type LoginResult =
  | { ok: true; user: AuthUser }
  | { ok: false; reason: LoginFailureReason; retryAfterSeconds?: number; correlationId?: string };

export interface AuthClient {
  /** Current session user, or null when not authenticated. Must not throw for 401. */
  getSession(): Promise<AuthUser | null>;
  login(credentials: LoginCredentials): Promise<LoginResult>;
  logout(): Promise<void>;
}

/** Default until the API client is wired: nobody is signed in and login reports the service as unavailable. */
export const unconfiguredAuthClient: AuthClient = {
  getSession: () => Promise.resolve(null),
  login: () => Promise.resolve({ ok: false, reason: "unavailable" }),
  logout: () => Promise.resolve(),
};

export const sessionQueryKey = ["session"] as const;

export function sessionQueryOptions(authClient: AuthClient) {
  return queryOptions({
    queryKey: sessionQueryKey,
    queryFn: () => authClient.getSession(),
    staleTime: 60_000,
  });
}
