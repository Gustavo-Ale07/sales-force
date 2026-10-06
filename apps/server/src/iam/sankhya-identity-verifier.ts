import type {
  ExternalCredentials,
  ExternalIdentityVerifier,
  ExternalVerifyResult,
  SecretValue,
} from './external-identity.js';
import { verifiedIdentitySchema } from '../verifier/contract.js';

export interface SankhyaIdentityVerifierOptions {
  /** Base URL of the internal verifier (internal network only), e.g. `http://verifier:3002`. */
  readonly url: string;
  readonly sharedSecret: SecretValue;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Client of the internal identity verifier process (STACK-2a). It never talks to Sankhya: the verifier owns the
 * (still undefined) human-authentication mechanism, and today answers a uniform denial.
 *
 * Mapping, fail closed: 200 + a valid identity -> identity; 403 denial -> invalid credentials; 429 -> rate limited;
 * everything else (network error, timeout, 4xx/5xx, malformed body) -> unavailable, never a credential verdict.
 * The password travels only in the request body, is never logged and is not retained; the response body is parsed
 * by schema and never logged. The caller's signal bounds the call; there is no retry of a credential check.
 */
export class SankhyaIdentityVerifier implements ExternalIdentityVerifier {
  readonly #endpoint: string;
  readonly #secret: SecretValue;
  readonly #fetch: typeof fetch;

  constructor(options: SankhyaIdentityVerifierOptions) {
    this.#endpoint = `${options.url.replace(/\/+$/, '')}/internal/verify`;
    this.#secret = options.sharedSecret;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async verify(credentials: ExternalCredentials, signal: AbortSignal): Promise<ExternalVerifyResult> {
    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.#secret.reveal()}` },
        body: JSON.stringify({ login: credentials.login, password: credentials.password.reveal() }),
        redirect: 'error',
        signal,
      });
    } catch {
      return { fail: 'unavailable' };
    }
    try {
      if (response.status === 403) return { fail: 'invalid_credentials' };
      if (response.status === 429) return { fail: 'rate_limited' };
      if (response.status !== 200) return { fail: 'unavailable' };
      const parsed = verifiedIdentitySchema.safeParse(await response.json());
      if (!parsed.success) return { fail: 'unavailable' };
      return {
        ok: {
          externalUserId: String(parsed.data.codusu),
          displayName: '',
          sellerCode: parsed.data.codvend,
          active: parsed.data.active,
        },
      };
    } catch {
      return { fail: 'unavailable' };
    }
  }
}
