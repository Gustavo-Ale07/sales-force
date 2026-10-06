/**
 * Boundary for verifying a login/password pair against an EXTERNAL identity source (the ERP user
 * directory). The port lives here; the only implementation is `SankhyaIdentityVerifier`, which talks to the
 * internal verifier process (STACK-2a) and never to Sankhya itself.
 *
 * Status: the human-authentication mechanism of Sankhya is NOT DEFINED in the project ("Falta definir o
 * mecanismo oficial de autenticação humana do Sankhya."). The verifier's live adapter does not exist, so
 * today it answers a uniform denial. Nothing in this file calls Sankhya or knows its formats (SNK-1, P-02).
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
 * Link between an external user and a Sales Force account, plus the seller facts the login rule needs.
 * Identity is the stable directory id only (never the login text). Only a non-privileged `seller` account may
 * be provisioned from a verified identity, and only for a seller that exists, is active and unlinked in the
 * mirror; admin/manager/technical accounts are never created here. Implementation: `DrizzleExternalAccountLinks`.
 */
export interface ExternalAccountLinks {
  findAccountId(externalUserId: string): Promise<string | null>;
  /** True when the mirrored seller exists, is not deleted and is active in the ERP. */
  isSellerActive(sellerCode: number): Promise<boolean>;
  /**
   * Creates the seller account of a verified directory user and links it to its seller. Returns the new
   * account id, or `null` when a precondition fails (seller missing/inactive, already linked to another
   * account, installation configuration missing). Idempotent under a race: the loser gets the winner's id.
   */
  provisionSeller(input: { externalUserId: string; sellerCode: number; now: Date }): Promise<string | null>;
}
