import type { Account, AccountRole } from "@salesforce/contracts";
import { ApiRequestError, callApi, type ApiClient } from "./api";
import type { AuthClient, AuthUser, LoginResult } from "./auth-client";

const roleLabels: Record<AccountRole, string> = {
  admin: "Administrador",
  manager: "Gerente",
  seller: "Vendedor",
  technical: "Técnico",
};

export function toAuthUser(account: Account): AuthUser {
  return {
    id: account.id,
    name: account.displayName,
    username: account.username,
    role: account.role,
    roleLabel: roleLabels[account.role],
    sellerCodes: account.sellerCodes,
  };
}

/**
 * Maps a failed login to the UI reason. Server codes: `invalid_credentials` (401, also covers an
 * account whose profile may not use the web channel — AUTH-3 is folded into it on purpose so the
 * response never reveals *why* a login failed, only *that* it failed), `rate_limited` (429, with
 * `Retry-After`), everything else (403, 503, network, unexpected) is "unavailable". A 400 is
 * answered like a wrong credential: no detail leaks.
 *
 * A 403 on `/auth/login` is never a business-rule refusal: the access guard rejects cross-site/
 * disallowed-origin requests with a generic 403 *before* the login handler runs (see `csrf.ts`),
 * so it must not be shown as "channel_forbidden" (that message is reserved for a real channel
 * restriction, which today never reaches this status code). Mapping it to "unavailable" avoids
 * displaying a specific, wrong reason for what is actually a request the server never evaluated.
 */
export function mapLoginFailure(error: ApiRequestError): Extract<LoginResult, { ok: false }> {
  const correlationId = error.correlationId;
  switch (error.status) {
    case 400:
    case 401:
      return { ok: false, reason: "invalid_credentials", correlationId };
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
