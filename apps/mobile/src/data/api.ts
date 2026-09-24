import { createApiClient, type ApiClient } from "@salesforce/contracts/client";

export type { ApiClient };

export interface MobileApiClientOptions {
  /** Test seam: replaces the global `fetch`. */
  readonly fetch?: (request: Request) => Promise<Response>;
}

/**
 * The single API-client module of the mobile app: every request goes through the client generated from the
 * OpenAPI contract (STACK-4). `baseUrl` already includes `API_BASE_PATH` (see `resolveApiBaseUrl`).
 *
 * INTERIM TRANSPORT: the server only knows the cookie session. The native HTTP stack keeps the HttpOnly
 * session cookie in its own cookie jar; this code never reads, stores or logs a token. The mobile
 * access/refresh tokens and device approval of security-model 3.2 and 4.1 (AUTH-1, AUTH-2, Round 4) are
 * PROPOSED and not implemented; replacing this transport is the Round 4 increment.
 */
export function createMobileApiClient(baseUrl: string, options: MobileApiClientOptions = {}): ApiClient {
  return createApiClient(baseUrl, {
    credentials: "include",
    headers: { Accept: "application/json" },
    // Resolve the global lazily so test stubs installed after import are honoured.
    fetch: options.fetch ?? ((request: Request) => globalThis.fetch(request)),
  });
}

/** A failed API call, normalised from the `{ code, message, details? }` envelope of the contract. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryAfterSeconds?: number;
  readonly correlationId?: string;

  constructor(init: {
    status: number;
    message: string;
    code?: string;
    retryAfterSeconds?: number;
    correlationId?: string;
  }) {
    super(init.message);
    this.name = "ApiRequestError";
    this.status = init.status;
    this.code = init.code;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.correlationId = init.correlationId;
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

function retryAfter(header: string | null): number | undefined {
  return header !== null && /^\d+$/.test(header.trim()) ? Number(header.trim()) : undefined;
}

/**
 * Runs a generated-client call and returns its body. Every failure (network included, `status: 0`) becomes an
 * `ApiRequestError`; callers never see a raw `Response`.
 */
export async function callApi<T>(call: () => Promise<ClientResult<T>>): Promise<T> {
  let result: ClientResult<T>;
  try {
    result = await call();
  } catch {
    throw new ApiRequestError({ status: 0, message: "Sem conexão com o servidor." });
  }
  if (!result.response.ok) {
    const envelope = record(result.error);
    throw new ApiRequestError({
      status: result.response.status,
      code: typeof envelope?.code === "string" ? envelope.code : undefined,
      message: typeof envelope?.message === "string" ? envelope.message : `HTTP ${result.response.status}`,
      retryAfterSeconds: retryAfter(result.response.headers.get("retry-after")),
      correlationId: result.response.headers.get("x-request-id") ?? undefined,
    });
  }
  return result.data as T;
}
