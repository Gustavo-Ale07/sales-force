import { ApiRequestError, callApi, type ApiClient } from "../data/api";
import type { AuthPort, LoginResult } from "./auth-port";

/**
 * Maps a failed login to a UI reason. `invalid_credentials` (401) also covers an account whose profile may not
 * use this channel (AUTH-3): the server never reveals why a login failed. A 400 is answered like a wrong
 * credential. A 403 is the access guard refusing the request before the handler ran (never a business
 * refusal), so it is "unavailable", not a specific wrong reason.
 */
export function mapLoginFailure(error: ApiRequestError): Extract<LoginResult, { ok: false }> {
  if (error.status === 403 && error.code === "access_not_configured") return { ok: false, reason: "access_not_configured" };
  switch (error.status) {
    case 400:
    case 401:
      return { ok: false, reason: "invalid_credentials" };
    case 429:
      return { ok: false, reason: "rate_limited", retryAfterSeconds: error.retryAfterSeconds };
    default:
      return { ok: false, reason: "unavailable" };
  }
}

/** `AuthPort` over the generated API client and the existing cookie session (interim transport, see `api.ts`). */
export function createHttpAuth(api: ApiClient): AuthPort {
  return {
    async getSession() {
      try {
        const session = await callApi(() => api.GET("/auth/session"));
        return session.authenticated ? session.account : null;
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) return null;
        throw error;
      }
    },

    async login(credentials) {
      try {
        const session = await callApi(() => api.POST("/auth/login", { body: credentials }));
        return { ok: true, account: session.account };
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
