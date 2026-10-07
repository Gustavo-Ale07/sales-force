import { DENIAL, type IdentityVerification, type VerifiedIdentity, type VerifyDenial, type VerifyRequest } from './contract.js';

/**
 * Live identity verification against the Sankhya SANDBOX (AUTH-5, STACK-2a). Runs only inside the internal verifier
 * process. The protocol is the one of `.claude/work/auth-spike/sankhya-login-probe.mjs`:
 *
 *  1. `POST {origin}/mge/service.sbr?serviceName=MobileLoginSP.login&outputType=json`, JSON body
 *     `{ serviceName, requestBody: { NOMUSU: {$: login}, INTERNO: {$: password}, KEEPCONNECTED: {$: 'N'} } }`.
 *     Success = HTTP 200 + `responseBody.jsessionid.$`. A rejected credential is HTTP 200 + `status "0"` + a `tsError`
 *     (observed: `CORE_E01434`). The password exists only in this request body.
 *  2. With that session only (cookie `JSESSIONID`), one `CRUDServiceProvider.loadRecords` on entity `Usuario` reads the
 *     stable `CODUSU` and `CODVEND` of the user that just authenticated (login column configurable: NEEDS VALIDATION).
 *  3. `MobileLoginSP.logout` always runs afterwards (best effort). The Sankhya session id is never returned, logged
 *     or stored.
 *
 * Classification (fail closed): only a known credential-rejection code is a denial. Transport errors, timeouts,
 * non-200 answers, non-JSON bodies, unknown functional errors and an unresolvable identity THROW, which the server maps
 * to `unavailable` (503): never reported as "wrong password". Nothing here logs request or response bodies.
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
  /** `Usuario` field holding the login typed by the user. */
  readonly loginField: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
  /** Receives only a short outcome class (never a body, login or session id). */
  readonly onOutcome?: (outcome: string) => void;
}

interface JsonObject {
  readonly [key: string]: unknown;
}

function asObject(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : null;
}

/** Sankhya JSON wraps scalars as `{ "$": value }`. */
function scalar(value: unknown): string | null {
  const wrapped = asObject(value);
  const raw = wrapped === null ? value : wrapped['$'];
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number') return String(raw);
  return null;
}

export class SankhyaLoginVerification implements IdentityVerification {
  readonly #origin: string;
  readonly #loginField: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  readonly #outcome: (outcome: string) => void;

  constructor(options: SankhyaLoginVerificationOptions) {
    this.#origin = options.origin.replace(/\/+$/, '');
    this.#loginField = options.loginField;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? (() => new Date());
    this.#outcome = options.onOutcome ?? (() => undefined);
  }

  async verify(request: VerifyRequest, signal: AbortSignal): Promise<VerifiedIdentity | VerifyDenial> {
    const login = await this.#login(request, signal);
    if (login === 'rejected') {
      this.#outcome('credentials_rejected');
      return DENIAL;
    }
    try {
      const identity = await this.#identity(login, request.login, signal);
      this.#outcome('verified');
      return { ok: true, ...identity, verifiedAt: this.#now().toISOString() };
    } finally {
      await this.#logout(login);
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

  /** Returns the Sankhya session id (kept in memory only) or `rejected` for a credential rejection. */
  async #login(request: VerifyRequest, signal: AbortSignal): Promise<string | 'rejected'> {
    const answer = await this.#post(
      'MobileLoginSP.login',
      { NOMUSU: { $: request.login }, INTERNO: { $: request.password }, KEEPCONNECTED: { $: 'N' } },
      signal,
    );
    const session = scalar(asObject(answer['responseBody'])?.['jsessionid']);
    if (session !== null && session !== '' && session !== 'undefined') return session;
    const code = scalar(asObject(answer['tsError'])?.['tsErrorCode']);
    if (String(answer['status']) === '0' && code !== null && CREDENTIAL_REJECTION_CODES.includes(code)) return 'rejected';
    this.#outcome(`login_unclassified${code === null ? '' : `:${code.replace(/[^A-Za-z0-9_]/g, '').slice(0, 32)}`}`);
    throw new SankhyaUnavailableError('login_unclassified');
  }

  /** CODUSU / CODVEND of the user that owns `session`, found by the login typed (bound parameter, never concatenated). */
  async #identity(
    session: string,
    login: string,
    signal: AbortSignal,
  ): Promise<{ codusu: number; codvend: number | null; active: boolean }> {
    const answer = await this.#post(
      'CRUDServiceProvider.loadRecords',
      {
        dataSet: {
          rootEntity: 'Usuario',
          includePresentationFields: 'N',
          offsetPage: '0',
          criteria: { expression: { $: `this.${this.#loginField} = ?` }, parameter: [{ $: login, type: 'S' }] },
          entity: { fieldset: { list: 'CODUSU,CODVEND' } },
        },
      },
      signal,
      session,
    );
    const entities = asObject(answer['responseBody'])?.['entities'];
    const container = asObject(entities);
    const fieldList = asObject(asObject(container?.['metadata'])?.['fields'])?.['field'];
    const fields = (Array.isArray(fieldList) ? fieldList : fieldList === undefined ? [] : [fieldList]).map((field) =>
      String(asObject(field)?.['name'] ?? ''),
    );
    const rawEntity = container?.['entity'];
    const rows = Array.isArray(rawEntity) ? rawEntity : rawEntity === undefined ? [] : [rawEntity];
    // Exactly one user must match; anything else cannot establish a stable identity.
    if (rows.length !== 1) throw new SankhyaUnavailableError('identity_unresolved');
    const row = asObject(rows[0]);
    const pick = (name: string): string | null => {
      const index = fields.indexOf(name);
      return index < 0 ? null : scalar(row?.[`f${index}`]);
    };
    const codusu = Number(pick('CODUSU'));
    if (!Number.isInteger(codusu) || codusu <= 0) throw new SankhyaUnavailableError('identity_unresolved');
    const vendor = Number(pick('CODVEND') ?? '0');
    // Sankhya refuses a login of a blocked user itself; `TSIUSU` has no active flag (F-34), so a verified login is active here.
    return { codusu, codvend: Number.isInteger(vendor) && vendor > 0 ? vendor : null, active: true };
  }

  async #logout(session: string): Promise<void> {
    try {
      await this.#post('MobileLoginSP.logout', {}, AbortSignal.timeout(LOGOUT_TIMEOUT_MS), session);
    } catch {
      // Best effort: the Sankhya session expires on its own; nothing here can change the verdict.
    }
  }
}
