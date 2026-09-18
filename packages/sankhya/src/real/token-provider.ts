import { SankhyaGatewayError, classifyHttpFailure, parseRetryAfterMs } from '../errors.js';
import { Secret } from '../secret.js';
import type { HttpTransport } from './transport.js';

export interface SankhyaCredentials {
  readonly clientId: Secret;
  readonly clientSecret: Secret;
  readonly xToken: Secret;
}

export interface TokenProviderOptions {
  /** Checked, allow-listed origin (see host-guard). */
  readonly origin: string;
  readonly credentials: SankhyaCredentials;
  readonly transport: HttpTransport;
  /** Injected clock, ms since epoch. */
  readonly now: () => number;
  readonly requestTimeoutMs: number;
  /** Renew this long before the announced expiry. Default 30 s (`expires_in` is 300 s, F-03). */
  readonly renewSkewMs?: number;
}

interface CachedToken {
  readonly value: Secret;
  readonly expiresAt: number;
}

const DEFAULT_RENEW_SKEW_MS = 30_000;

/**
 * OAuth 2.0 client-credentials token with `X-Token` (F-01, F-02, F-03; VALIDATED (env) for the flow,
 * VALIDATED (docs) for the exact form fields - confirm in an authorized environment). Caches the
 * bearer token and renews it before expiry. Failure to authenticate is its own error class (`auth`)
 * and is never retried automatically (repeating it risks locking the integration user).
 * Tokens, `client_secret` and `X-Token` are never logged or placed in error messages.
 */
export class TokenProvider {
  readonly #options: TokenProviderOptions;
  #cached: CachedToken | null = null;
  #inFlight: Promise<Secret> | null = null;

  constructor(options: TokenProviderOptions) {
    this.#options = options;
  }

  async getToken(signal?: AbortSignal): Promise<Secret> {
    const cached = this.#cached;
    const skew = this.#options.renewSkewMs ?? DEFAULT_RENEW_SKEW_MS;
    if (cached && this.#options.now() < cached.expiresAt - skew) return cached.value;
    this.#inFlight ??= this.#authenticate(signal).finally(() => {
      this.#inFlight = null;
    });
    return this.#inFlight;
  }

  /** Called after an HTTP 403 (expired/invalid token, F-31) so the next `getToken` re-authenticates. */
  invalidate(): void {
    this.#cached = null;
  }

  async #authenticate(signal?: AbortSignal): Promise<Secret> {
    const { origin, credentials, transport, now, requestTimeoutMs } = this.#options;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: credentials.clientId.reveal(),
      client_secret: credentials.clientSecret.reveal(),
    }).toString();
    const response = await transport({
      method: 'POST',
      url: `${origin}/authenticate`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        'x-token': credentials.xToken.reveal(),
      },
      body,
      timeoutMs: requestTimeoutMs,
      signal,
    });

    if (response.status !== 200) {
      // Authentication endpoint: a 400/401/403 means the credentials were refused -> `auth`.
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        throw new SankhyaGatewayError('auth', {
          code: `auth_http_${response.status}`,
          message: `Authentication failed (HTTP ${response.status}). The integration credentials or X-Token were refused; check them for this environment. Not retried automatically.`,
        });
      }
      throw classifyHttpFailure(response.status, 'Authentication', parseRetryAfterMs(response.headers['retry-after']));
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      throw invalidTokenResponse();
    }
    if (typeof parsed !== 'object' || parsed === null) throw invalidTokenResponse();
    const record = parsed as Record<string, unknown>;
    const accessToken = record['access_token'];
    const expiresIn = record['expires_in'];
    if (typeof accessToken !== 'string' || accessToken.trim() === '') throw invalidTokenResponse();
    const seconds = typeof expiresIn === 'number' ? expiresIn : typeof expiresIn === 'string' ? Number(expiresIn) : NaN;
    if (!Number.isFinite(seconds) || seconds <= 0) throw invalidTokenResponse();

    const value = new Secret(accessToken.trim());
    this.#cached = { value, expiresAt: now() + seconds * 1000 };
    return value;
  }
}

function invalidTokenResponse(): SankhyaGatewayError {
  return new SankhyaGatewayError('validation', {
    code: 'invalid_token_response',
    message: 'The authentication response did not have the expected shape (access_token, expires_in).',
  });
}
