import type { DirectoryRefusal } from '@salesforce/domain';

/**
 * Boundary for verifying a login/password pair against an EXTERNAL identity source (the ERP user
 * directory). The port lives here; the only implementation is `SankhyaIdentityVerifier`, which talks to the
 * internal verifier process (STACK-2a) and never to Sankhya itself.
 *
 * Status: the human-authentication mechanism is `MobileLoginSP.login` on the Sankhya SANDBOX (owner-run probe, 2026-10-07),
 * with a uniform denial while the verifier is disabled. Nothing in this file calls Sankhya or knows its formats (SNK-1, P-02).
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

/** What the official-relation sync did for one directory user (never carries PII). */
export type DirectorySyncOutcome =
  | {
      readonly ok: true;
      readonly accountId: string;
      /** `created`: new seller account + link; `linked`: existing account got its automatic link; `relinked`: the ERP moved the seller;
       *  `unchanged`: link already current; `not_managed`: not an automatic seller account (manual link or another role): untouched. */
      readonly action: 'created' | 'linked' | 'relinked' | 'unchanged' | 'not_managed';
    }
  | {
      readonly ok: false;
      readonly refusal: DirectoryRefusal;
      /** The account the refusal concerns, when there is one. */
      readonly accountId: string | null;
      /** True when an automatic link was removed and the account's sessions were revoked because of it. */
      readonly revoked: boolean;
    };

/**
 * Link between an external user and a Sales Force account, plus the seller facts the login rule needs.
 * Identity is the stable directory id only (never the login text). Only a non-privileged `seller` account may
 * be provisioned from a verified identity, and only from the OFFICIAL ERP user -> seller relation (CFG-2): admin/manager/technical
 * accounts are never created or changed here, and a manual (administrator) link is never touched. Implementation: `DrizzleExternalAccountLinks`.
 */
export interface ExternalAccountLinks {
  findAccountId(externalUserId: string): Promise<string | null>;
  /** True when the mirrored seller exists, is not deleted and is active in the ERP. */
  isSellerActive(sellerCode: number): Promise<boolean>;
  /**
   * Creates or reconciles the seller account of a verified directory user from the mirrored official relation, in ONE transaction
   * (row lock on the seller, unique constraints), so concurrent first logins yield one account and one link. Fails closed: a stale or
   * missing mirror, no seller, inactive/ambiguous/claimed seller or any conflict is a refusal, never a guess. A definitive refusal on an
   * automatic link removes that link and revokes the account's sessions; a stale mirror changes nothing. Idempotent.
   */
  syncFromDirectory(input: { externalUserId: string; now: Date; maxMirrorAgeMs: number; allowCreate: boolean }): Promise<DirectorySyncOutcome>;
}
