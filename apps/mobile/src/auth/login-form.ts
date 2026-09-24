import { LoginRequestSchema, type LoginRequest } from "@salesforce/contracts";

export interface LoginFormInput {
  readonly email: string;
  readonly password: string;
}

export interface LoginFormErrors {
  readonly email?: string;
  readonly password?: string;
}

export type LoginFormResult =
  | { readonly ok: true; readonly value: LoginRequest }
  | { readonly ok: false; readonly errors: LoginFormErrors };

/**
 * Client-side check of the login form against the contract schema (`LoginRequestSchema`, the same rules the
 * server applies). It only saves a round trip: the server stays the authority and decides on the credentials.
 * The password is never trimmed or altered.
 */
export function validateLoginForm(input: LoginFormInput): LoginFormResult {
  const email = input.email.trim();
  const errors: { email?: string; password?: string } = {};

  if (email.length === 0) errors.email = "Informe seu e-mail.";
  else if (email.length > 254) errors.email = "O e-mail é longo demais.";
  if (input.password.length === 0) errors.password = "Informe sua senha.";
  else if (input.password.length > 256) errors.password = "A senha é longa demais.";
  if (errors.email !== undefined || errors.password !== undefined) return { ok: false, errors };

  const parsed = LoginRequestSchema.safeParse({ email, password: input.password });
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, errors: { email: "Informe um e-mail válido." } };
}
