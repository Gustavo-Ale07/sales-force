import { LoginRequestSchema, type LoginRequest } from "@salesforce/contracts";

export interface LoginFormInput {
  readonly username: string;
  readonly password: string;
}

export interface LoginFormErrors {
  readonly username?: string;
  readonly password?: string;
}

export type LoginFormResult =
  | { readonly ok: true; readonly value: LoginRequest }
  | { readonly ok: false; readonly errors: LoginFormErrors };

/**
 * Client-side check of the login form against the contract schema (`LoginRequestSchema`, the same rules the
 * server applies). It only saves a round trip: the server stays the authority and decides on the credentials.
 * The username is only trimmed (no e-mail format, no case change); the password is never trimmed or altered.
 */
export function validateLoginForm(input: LoginFormInput): LoginFormResult {
  const username = input.username.trim();
  const errors: { username?: string; password?: string } = {};

  if (username.length === 0) errors.username = "Informe o usuário.";
  else if (username.length > 254) errors.username = "O usuário é longo demais.";
  if (input.password.length === 0) errors.password = "Informe sua senha.";
  else if (input.password.length > 256) errors.password = "A senha é longa demais.";
  if (errors.username !== undefined || errors.password !== undefined) return { ok: false, errors };

  const parsed = LoginRequestSchema.safeParse({ username, password: input.password });
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, errors: { username: "Informe o usuário." } };
}
