/**
 * Boundary for verifying a login/password pair against an EXTERNAL identity source (the ERP user
 * directory). Only the port lives here: there is no real implementation yet.
 *
 * Status: the real mechanism is UNPROVEN (BLOCKER-SNK-CREDENTIALS) and STACK-2 confines Sankhya
 * credentials to the worker, so a real adapter needs an owner decision (STACK-2 exception) before it
 * exists. Nothing in this file calls Sankhya or knows its formats (SNK-1, P-02).
 */

/** A password that must not leak through logging, JSON or string conversion. Memory only, never persisted. */
export interface SecretValue {
  reveal(): string;
}

/** Minimal secret holder: every implicit conversion is redacted; only `reveal()` gives the value. */
export class CredentialSecret implements SecretValue {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return '[redacted]';
  }

  toJSON(): string {
    return '[redacted]';
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '[redacted]';
  }
}

export interface ExternalCredentials {
  readonly login: string;
  readonly password: SecretValue;
}

export interface ExternalIdentity {
  /** Stable identifier of the user in the external directory. Never the login text. */
  readonly externalUserId: string;
  readonly displayName: string;
  /** The seller (CODVEND) the directory ties to the user, or null. Informational: validated, never trusted for scope. */
  readonly sellerCode: number | null;
  /** False when the directory says the user is disabled. */
  readonly active: boolean;
}

export type ExternalVerifyFailure = 'invalid_credentials' | 'unavailable' | 'rate_limited' | 'unmapped';

export type ExternalVerifyResult = { readonly ok: ExternalIdentity } | { readonly fail: ExternalVerifyFailure };

/**
 * Implementations must: honor `signal` (abort = unavailable); never log, persist or retain the
 * password; map every transport/protocol problem to `unavailable`, never to `invalid_credentials`;
 * never retry a credential check on their own.
 */
export interface ExternalIdentityVerifier {
  verify(credentials: ExternalCredentials, signal: AbortSignal): Promise<ExternalVerifyResult>;
}

/**
 * Explicit link between an external user and an existing Sales Force account. Accounts are never
 * created from an external identity (no auto-provisioning of privileged accounts). Where the link is
 * stored and who maintains it is an owner decision (no table exists yet).
 */
export interface ExternalAccountLinks {
  findAccountId(externalUserId: string): Promise<string | null>;
}
