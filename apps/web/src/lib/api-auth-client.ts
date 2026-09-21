import type { Account, AccountRole } from "@salesforce/contracts";
import { ApiRequestError, callApi, type ApiClient } from "./api";
import type { AuthClient, AuthUser, LoginResult } from "./auth-client";

const roleLabels: Record<AccountRole, string> = {
  admin: "Administrador",
  manager: "Gerente",
  seller: "Vendedor",
};

export function toAuthUser(account: Account): AuthUser {
  return {
    id: account.id,
    name: account.displayName,
    email: account.email,
    role: account.role,
    roleLabel: roleLabels[account.role],
    sellerCodes: account.sellerCodes,
  };
}

/**
 * Maps a failed login to the UI reason. Server codes: `invalid_credentials` (401), `rate_limited` (429, with
 * `Retry-After`), `forbidden` (403: the profile may not use the web channel, AUTH-3), everything else
 * (503, network, unexpected) is "unavailable". A 400 is answered like a wrong credential: no detail leaks.
 */
export function mapLoginFailure(error: ApiRequestError): Extract<LoginResult, { ok: false }> {
  const correlationId = error.correlationId;
  switch (error.status) {
    case 400:
    case 401:
      return { ok: false, reason: "invalid_credentials", correlationId };
    case 403:
      return { ok: false, reason: "channel_forbidden", correlationId };
    case 429:
      return { ok: false, reason: "rate_limited", retryAfterSeconds: error.retryAfterSeconds, correlationId };
    default:
      return { ok: false, reason: "unavailable", correlationId };
  }
}

/** `AuthClient` over the generated API client. Session state lives in the HttpOnly cookie only. */
export function createApiAuthClient(api: ApiClient): AuthClient {
  return {
    async getSession() {
      try {
        const session = await callApi(() => api.GET("/auth/session"));
        return session.authenticated ? toAuthUser(session.account) : null;
      } catch (error) {
        // 401: no valid session, which is an anonymous visitor rather than a failure.
        if (error instanceof ApiRequestError && error.status === 401) return null;
        throw error;
      }
    },

    async login(credentials) {
      try {
        const session = await callApi(() => api.POST("/auth/login", { body: credentials }));
        return { ok: true, user: toAuthUser(session.account) };
      } catch (error) {
        if (error instanceof ApiRequestError) return mapLoginFailure(error);
        throw error;
      }
    },

    async logout() {
      try {
        await callApi(() => api.POST("/auth/logout"));
      } catch (error) {
        // 401: the session was already gone, which is the goal of logging out.
        if (error instanceof ApiRequestError && error.status === 401) return;
        throw error;
      }
    },
  };
}
