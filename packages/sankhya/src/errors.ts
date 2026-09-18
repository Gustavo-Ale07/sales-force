/**
 * Integration error taxonomy (`.claude/rules/sankhya.md` "Limits and errors").
 *
 * Every failure that leaves this package is classified so the worker can decide what to do without
 * parsing messages:
 *
 * | kind          | meaning                                                        | retryable |
 * |---------------|----------------------------------------------------------------|-----------|
 * | `unavailable` | ERP or network not reachable / gateway unavailable             | yes       |
 * | `rate_limit`  | throttled (limits are unmeasured, S0.2; signal never observed) | yes       |
 * | `temporary`   | transient technical failure, incomplete snapshot, unknown gateway status | yes |
 * | `auth`        | credentials/token rejected, permission missing                 | NO        |
 * | `validation`  | the response (or a config file) violates the expected contract | NO        |
 * | `permanent`   | business/SQL/endpoint rejection, not implemented, misconfiguration | NO    |
 *
 * Permanent, validation and auth failures are never retried blindly: repeating them cannot succeed,
 * and repeating an authentication failure risks locking the integration user.
 * Error messages never contain credentials, tokens or response bodies.
 */
export type SankhyaErrorKind =
  | 'unavailable'
  | 'auth'
  | 'validation'
  | 'rate_limit'
  | 'temporary'
  | 'permanent';

export const SANKHYA_ERROR_KINDS: readonly SankhyaErrorKind[] = [
  'unavailable',
  'auth',
  'validation',
  'rate_limit',
  'temporary',
  'permanent',
];

const RETRYABLE_KINDS: ReadonlySet<SankhyaErrorKind> = new Set<SankhyaErrorKind>([
  'unavailable',
  'rate_limit',
  'temporary',
]);

export function isRetryableKind(kind: SankhyaErrorKind): boolean {
  return RETRYABLE_KINDS.has(kind);
}

export interface GatewayErrorInit {
  /** Stable machine-readable code, e.g. `http_503`, `sql_error`, `incomplete_snapshot`. */
  readonly code: string;
  /** Actionable, secret-free message. */
  readonly message: string;
  readonly cause?: unknown;
  /** Server-provided back-off hint in milliseconds, when present. */
  readonly retryAfterMs?: number;
}

export class SankhyaGatewayError extends Error {
  readonly kind: SankhyaErrorKind;
  readonly code: string;
  /** Derived from `kind`; never set independently. */
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;

  constructor(kind: SankhyaErrorKind, init: GatewayErrorInit) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = 'SankhyaGatewayError';
    this.kind = kind;
    this.code = init.code;
    this.retryable = isRetryableKind(kind);
    this.retryAfterMs = init.retryAfterMs ?? null;
  }
}

/**
 * Raised for anything that is not VALIDATED in `docs/sankhya-spike.md`. The message must end with a
 * `NEEDS VALIDATION <spike ref>` marker. Classified `permanent`: retrying cannot help.
 */
export class NotImplementedError extends SankhyaGatewayError {
  constructor(message: string) {
    super('permanent', { code: 'not_implemented', message });
    this.name = 'NotImplementedError';
  }
}

/**
 * Startup/configuration problem (bad environment, refused host, missing credentials). Thrown when a
 * gateway is created, never during normal operation. Lists variable names, never their values.
 */
export class GatewayConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Sankhya gateway configuration refused:\n- ${problems.join('\n- ')}`);
    this.name = 'GatewayConfigError';
    this.problems = problems;
  }
}

export function isSankhyaGatewayError(error: unknown): error is SankhyaGatewayError {
  return error instanceof SankhyaGatewayError;
}

/** Unknown (unclassified) errors are NOT retryable: the caller must classify them first. */
export function isRetryable(error: unknown): boolean {
  return isSankhyaGatewayError(error) && error.retryable;
}

/** Parses a `Retry-After` header given in seconds. HTTP-date form is ignored (never observed, F-31). */
export function parseRetryAfterMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const seconds = Number(value.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.round(seconds * 1000);
}

/**
 * Classifies a non-success HTTP status. The mapping is OUR policy (what the worker should do), not a
 * documented Sankhya behavior: only 403 `GTW3403` on expiry, 401 without token and the absence of 429
 * are observed facts (F-31).
 */
export function classifyHttpFailure(
  status: number,
  context: string,
  retryAfterMs?: number,
): SankhyaGatewayError {
  const code = `http_${status}`;
  const base = `${context}: HTTP ${status}`;
  if (status === 401 || status === 403) {
    return new SankhyaGatewayError('auth', {
      code,
      message: `${base}. The integration credentials or token were rejected; check the credentials and the integration user permissions. Not retried automatically.`,
    });
  }
  if (status === 429) {
    return new SankhyaGatewayError('rate_limit', {
      code,
      message: `${base}. Rate limit signalled by the ERP; back off before retrying.`,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
  }
  if (status === 502 || status === 503 || status === 504) {
    return new SankhyaGatewayError('unavailable', {
      code,
      message: `${base}. The ERP gateway is unavailable.`,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
  }
  if (status === 408 || status >= 500) {
    return new SankhyaGatewayError('temporary', { code, message: `${base}. Temporary ERP failure.` });
  }
  if (status === 400 || status === 422) {
    return new SankhyaGatewayError('validation', {
      code,
      message: `${base}. The ERP rejected the request as invalid.`,
    });
  }
  if (status >= 300 && status < 400) {
    return new SankhyaGatewayError('permanent', {
      code: 'unexpected_redirect',
      message: `${base}. Redirects are never followed (the target could leave the allow-listed host).`,
    });
  }
  return new SankhyaGatewayError('permanent', {
    code,
    message: `${base}. Unexpected response; check the configured base URL and endpoint.`,
  });
}
