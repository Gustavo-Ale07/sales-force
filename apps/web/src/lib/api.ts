import { createApiClient, type ApiClient } from "@salesforce/contracts/client";

/**
 * The single API-client module of the web app (STACK-4/5): every request goes through the client generated from
 * the OpenAPI contract, same origin, session cookie (HttpOnly, never readable here). No token is ever stored.
 *
 * Kept equal to `API_BASE_PATH` of `@salesforce/contracts`; a test asserts it. It is not imported from there
 * because the contracts main entry pulls the Zod schemas into the browser bundle.
 */
export const API_BASE_PATH = "/api/v1";

export type { ApiClient };

export interface WebApiClientOptions {
  /** Test seam: replaces `fetch`. Production uses the browser `fetch`. */
  fetch?: (request: Request) => Promise<Response>;
  /** Defaults to the page origin: the browser only ever talks to its own origin. */
  origin?: string;
}

/** Same-origin API client. Cookies are sent (`credentials: same-origin`) and never handled by the app. */
export function createWebApiClient(options: WebApiClientOptions = {}): ApiClient {
  const origin = options.origin ?? window.location.origin;
  return createApiClient(`${origin}${API_BASE_PATH}`, {
    // Resolve the browser fetch lazily: a captured reference would ignore later stubs and polyfills.
    fetch: options.fetch ?? ((request: Request) => globalThis.fetch(request)),
    headers: { Accept: "application/json" },
  });
}

/** A failed API call, normalised from the `{ code, message, details? }` envelope. */
export class ApiRequestError extends Error {
  readonly status: number;
  /** Stable server error code (`invalid_credentials`, `version_conflict`...). Absent on network failures. */
  readonly code?: string;
  readonly correlationId?: string;
  readonly retryAfterSeconds?: number;
  readonly issues: readonly { path: string; code: string; message?: string }[];

  constructor(init: {
    status: number;
    code?: string;
    message: string;
    correlationId?: string;
    retryAfterSeconds?: number;
    issues?: readonly { path: string; code: string; message?: string }[];
  }) {
    super(init.message);
    this.name = "ApiRequestError";
    this.status = init.status;
    this.code = init.code;
    this.correlationId = init.correlationId;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.issues = init.issues ?? [];
  }

  /** Network failure, timeout or a proxy answering without the API envelope. */
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

interface ClientResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function parseRetryAfter(header: string | null, details: Record<string, unknown> | undefined): number | undefined {
  const fromHeader = header && /^\d+$/.test(header.trim()) ? Number(header.trim()) : undefined;
  if (fromHeader !== undefined) return fromHeader;
  const fromBody = details?.retryAfterSeconds;
  return typeof fromBody === "number" && Number.isFinite(fromBody) && fromBody >= 0 ? fromBody : undefined;
}

/** Builds the error of a non-2xx response. The correlation id comes from `x-request-id` or `details.requestId`. */
export function toApiRequestError(response: Response, body: unknown): ApiRequestError {
  const envelope = record(body);
  const details = record(envelope?.details);
  const rawIssues = Array.isArray(details?.issues) ? details.issues : [];
  const issues = rawIssues.flatMap((issue) => {
    const item = record(issue);
    return item && typeof item.path === "string" && typeof item.code === "string"
      ? [{ path: item.path, code: item.code, message: typeof item.message === "string" ? item.message : undefined }]
      : [];
  });
  const requestId = typeof details?.requestId === "string" ? details.requestId : undefined;
  return new ApiRequestError({
    status: response.status,
    code: typeof envelope?.code === "string" ? envelope.code : undefined,
    message: typeof envelope?.message === "string" ? envelope.message : `HTTP ${response.status}`,
    correlationId: response.headers.get("x-request-id") ?? requestId ?? undefined,
    retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after"), details),
    issues,
  });
}

/**
 * Runs a generated-client call and returns its body, throwing `ApiRequestError` for every failure (including
 * network errors, `status: 0`). Callers never see a raw `Response`.
 */
export async function callApi<T>(call: () => Promise<ClientResult<T>>): Promise<T> {
  let result: ClientResult<T>;
  try {
    result = await call();
  } catch {
    throw new ApiRequestError({ status: 0, message: "Sem conexão com o servidor." });
  }
  if (!result.response.ok) throw toApiRequestError(result.response, result.error);
  return result.data as T;
}
