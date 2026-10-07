import {
  DENIAL,
  EXTERNAL_USER_ID_PATTERN,
  type IdentityVerification,
  type VerifiedIdentity,
  type VerifyDenial,
  type VerifyRequest,
} from './contract.js';

/**
 * Live identity verification against the Sankhya SANDBOX (AUTH-5, STACK-2a). Runs only inside the internal verifier
 * process. Protocol proven with the Sandbox (owner-run probe, 2026-10-07):
 *
 *  1. `POST {origin}/mge/service.sbr?serviceName=MobileLoginSP.login&outputType=json`, JSON body
 *     `{ serviceName, requestBody: { NOMUSU: {$: login}, INTERNO: {$: password}, KEEPCONNECTED: {$: 'N'} } }`.
 *     Success = HTTP 200 + status "1" + `responseBody.jsessionid` + `responseBody.idusu`, in the SAME response that
 *     authenticated the password: the identity cannot be swapped for another user's. A rejected credential is HTTP 200 +
 *     status "0" + `tsError.tsErrorCode` (observed: `CORE_E01434`). The password exists only in this request body.
 *  2. `MobileLoginSP.logout` always runs afterwards (best effort). The Sankhya session id is never returned, logged or
 *     stored. No second Sankhya call reads user data (a user session cannot call other gateway services without a
 *     Bearer token, observed).
 *
 * `idusu` is treated as the stable external user id only; that it equals `TSIUSU.CODUSU` is NOT proven. Seller links
 * are never resolved here.
 *
 * Classification (fail closed): only a known credential-rejection code is a denial. Transport errors, timeouts,
 * non-200 answers, non-JSON bodies, unknown functional errors and a missing/invalid `jsessionid` or `idusu` THROW, which the
 * server maps to `unavailable` (503): never reported as "wrong password". Nothing here logs request or response bodies.
 */

/** `tsErrorCode` values Sankhya answers (HTTP 200, status "0") when the user/password pair is rejected. */
export const CREDENTIAL_REJECTION_CODES: readonly string[] = ['CORE_E01434'];

const GATEWAY_PATH = '/mge/service.sbr';
const LOGOUT_TIMEOUT_MS = 2000;

export class SankhyaUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`sankhya verification unavailable: ${reason}`);
    this.name = 'SankhyaUnavailableError';
  }
}

export interface SankhyaLoginVerificationOptions {
  /** Checked `https` origin of the SANDBOX host (no path). */
  readonly origin: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
  /** Receives only a short outcome class (never a body, login, id or session). */
  readonly onOutcome?: (outcome: string) => void;
}

interface JsonObject {
  readonly [key: string]: unknown;
}

function asObject(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : null;
}

/** Sankhya JSON wraps scalars as `{ "$": value }`; a bare scalar is accepted too. */
function scalar(value: unknown): string | null {
  const wrapped = asObject(value);
  const raw = wrapped === null ? value : wrapped['$'];
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' && Number.isSafeInteger(raw)) return String(raw);
  return null;
}

export class SankhyaLoginVerification implements IdentityVerification {
  readonly #origin: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  readonly #outcome: (outcome: string) => void;

  constructor(options: SankhyaLoginVerificationOptions) {
    this.#origin = options.origin.replace(/\/+$/, '');
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? (() => new Date());
    this.#outcome = options.onOutcome ?? (() => undefined);
  }

  async verify(request: VerifyRequest, signal: AbortSignal): Promise<VerifiedIdentity | VerifyDenial> {
    const answer = await this.#post(
      'MobileLoginSP.login',
      { NOMUSU: { $: request.login }, INTERNO: { $: request.password }, KEEPCONNECTED: { $: 'N' } },
      signal,
    );
    const body = asObject(answer['responseBody']);
    const session = scalar(body?.['jsessionid']);
    const hasSession = session !== null && session !== '' && session !== 'undefined';
    try {
      if (!hasSession) {
        const code = scalar(asObject(answer['tsError'])?.['tsErrorCode']);
        if (String(answer['status']) === '0' && code !== null && CREDENTIAL_REJECTION_CODES.includes(code)) {
          this.#outcome('credentials_rejected');
          return DENIAL;
        }
        this.#outcome(`login_unclassified${code === null ? '' : `:${code.replace(/[^A-Za-z0-9_]/g, '').slice(0, 32)}`}`);
        throw new SankhyaUnavailableError('login_unclassified');
      }
      const externalUserId = scalar(body?.['idusu'])?.trim() ?? null;
      if (externalUserId === null || !EXTERNAL_USER_ID_PATTERN.test(externalUserId) || /^0+$/.test(externalUserId)) {
        this.#outcome('identity_missing');
        throw new SankhyaUnavailableError('identity_missing');
      }
      this.#outcome('verified');
      return {
        ok: true,
        externalUserId: externalUserId.replace(/^0+(?=\d)/, ''),
        username: request.login.trim(),
        active: true,
        verifiedAt: this.#now().toISOString(),
      };
    } finally {
      if (hasSession) await this.#logout(session);
    }
  }

  async #post(serviceName: string, body: JsonObject, signal: AbortSignal, session?: string): Promise<JsonObject> {
    const query = `serviceName=${serviceName}&outputType=json${session === undefined ? '' : `&mgeSession=${encodeURIComponent(session)}`}`;
    let response: Response;
    try {
      response = await this.#fetch(`${this.#origin}${GATEWAY_PATH}?${query}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(session === undefined ? {} : { cookie: `JSESSIONID=${session}` }),
        },
        body: JSON.stringify({ serviceName, requestBody: body }),
        redirect: 'error',
        signal,
      });
    } catch {
      throw new SankhyaUnavailableError('network');
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      throw new SankhyaUnavailableError(`http_${response.status >= 500 ? '5xx' : 'other'}`);
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new SankhyaUnavailableError('non_json');
    }
    const parsed = asObject(json);
    if (parsed === null) throw new SankhyaUnavailableError('non_json');
    return parsed;
  }

  async #logout(session: string): Promise<void> {
    try {
      await this.#post('MobileLoginSP.logout', {}, AbortSignal.timeout(LOGOUT_TIMEOUT_MS), session);
    } catch {
      // Best effort: the Sankhya session expires on its own; nothing here can change the verdict.
    }
  }
}
