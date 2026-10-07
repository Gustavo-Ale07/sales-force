import type {
  DirectorySyncOutcome,
  ExternalAccountLinks,
  ExternalCredentials,
  ExternalIdentity,
  ExternalIdentityVerifier,
  ExternalVerifyResult,
} from '../../src/iam/external-identity.js';

export interface FakeDirectoryUser {
  /** Plain password of the synthetic user (test data only). */
  readonly password: string;
  readonly identity: ExternalIdentity;
}

/** Scripted verifier: a login -> user table, an optional forced outcome, and a call log (no passwords). */
export class FakeExternalIdentityVerifier implements ExternalIdentityVerifier {
  readonly users = new Map<string, FakeDirectoryUser>();
  /** Forces every call to this result (or to throw / hang when set to those markers). */
  forced: ExternalVerifyResult | 'throw' | 'hang' | null = null;
  readonly calls: { login: string; passwordWasSecret: boolean }[] = [];
  /** What the verifier received as `password` (to assert it is not a plain string). */
  lastPasswordObject: unknown = null;

  verify(credentials: ExternalCredentials, signal: AbortSignal): Promise<ExternalVerifyResult> {
    this.calls.push({ login: credentials.login, passwordWasSecret: typeof credentials.password !== 'string' });
    this.lastPasswordObject = credentials.password;
    if (this.forced === 'throw') return Promise.reject(new Error('boom: connection reset'));
    if (this.forced === 'hang') {
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }
    if (this.forced !== null) return Promise.resolve(this.forced);
    const user = this.users.get(credentials.login);
    if (user === undefined || user.password !== credentials.password.reveal()) {
      return Promise.resolve({ fail: 'invalid_credentials' });
    }
    return Promise.resolve({ ok: user.identity });
  }
}

export class InMemoryExternalAccountLinks implements ExternalAccountLinks {
  readonly links = new Map<string, string>();
  /** Seller codes reported inactive (every other code is active). */
  readonly inactiveSellers = new Set<number>();
  /** Directory syncs received, and what to answer (default: refuse, nothing is created). */
  readonly synced: { externalUserId: string; allowCreate: boolean }[] = [];
  syncResult: DirectorySyncOutcome = { ok: false, refusal: 'user_missing', accountId: null, revoked: false };

  findAccountId(externalUserId: string): Promise<string | null> {
    return Promise.resolve(this.links.get(externalUserId) ?? null);
  }

  isSellerActive(sellerCode: number): Promise<boolean> {
    return Promise.resolve(!this.inactiveSellers.has(sellerCode));
  }

  syncFromDirectory(input: { externalUserId: string; now: Date; maxMirrorAgeMs: number; allowCreate: boolean }): Promise<DirectorySyncOutcome> {
    this.synced.push({ externalUserId: input.externalUserId, allowCreate: input.allowCreate });
    return Promise.resolve(this.syncResult);
  }
}
