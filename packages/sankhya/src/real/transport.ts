import { SankhyaGatewayError } from '../errors.js';

/**
 * The only HTTP seam of the real adapter. Tests inject a mock; production uses `createFetchTransport`.
 * A transport never follows redirects (the target could leave the allow-listed host) and never
 * throws for HTTP error statuses: it returns them, and the adapter classifies them.
 */
export interface HttpRequest {
  readonly method: 'POST';
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal | undefined;
}

export interface HttpResponse {
  readonly status: number;
  /** Lower-cased header names. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;

const MAX_RESPONSE_CHARS = 64 * 1024 * 1024;

export function createFetchTransport(fetchImpl: typeof fetch = fetch): HttpTransport {
  return async (request) => {
    const timeout = AbortSignal.timeout(request.timeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetchImpl(request.url, {
        method: request.method,
        headers: { ...request.headers },
        body: request.body,
        redirect: 'manual',
        signal,
      });
    } catch (cause) {
      if (request.signal?.aborted) throw cause;
      const timedOut = timeout.aborted;
      // Never include the URL or the cause message: they may carry credentials from a mistyped URL.
      throw new SankhyaGatewayError(timedOut ? 'temporary' : 'unavailable', {
        code: timedOut ? 'timeout' : 'network_error',
        message: timedOut
          ? 'The ERP did not answer within the request timeout.'
          : 'The ERP could not be reached (network error).',
        cause,
      });
    }
    let body: string;
    try {
      body = await response.text();
    } catch (cause) {
      if (request.signal?.aborted) throw cause;
      throw new SankhyaGatewayError('temporary', {
        code: 'response_read_failed',
        message: 'The ERP response could not be read completely.',
        cause,
      });
    }
    if (body.length > MAX_RESPONSE_CHARS) {
      throw new SankhyaGatewayError('validation', {
        code: 'response_too_large',
        message: 'The ERP response exceeds the size limit; reduce the page size.',
      });
    }
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });
    return { status: response.status, headers, body };
  };
}
