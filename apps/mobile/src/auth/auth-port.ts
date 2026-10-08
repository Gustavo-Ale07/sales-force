import type { LoginRequest } from "@salesforce/contracts";
import type { ApiSchema } from "@salesforce/contracts/client";

export type Account = ApiSchema<"Account">;

export type LoginResult =
  | { readonly ok: true; readonly account: Account }
  | {
      readonly ok: false;
      readonly reason: "invalid_credentials" | "access_not_configured" | "rate_limited" | "unavailable";
      readonly retryAfterSeconds?: number;
    };

/**
 * Authentication port. The concrete adapter today is the interim cookie-session transport (`http-auth.ts`);
 * the mobile token + device-approval flow (AUTH-1, AUTH-2, Round 4, PROPOSED) will replace the adapter, not the
 * screens. Tokens never pass through this interface.
 */
export interface AuthPort {
  /** The live session, or `null` when there is none. Throws only for transport failures. */
  getSession(): Promise<Account | null>;
  login(credentials: LoginRequest): Promise<LoginResult>;
  logout(): Promise<void>;
}
