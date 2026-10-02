import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Logger } from '../observability/logger.js';
import {
  DENIAL,
  disabledVerification,
  verifyRequestSchema,
  type IdentityVerification,
  type VerifyResponse,
} from './contract.js';
import type { VerifierConfig } from './env.js';
import { VerifierThrottle } from './throttle.js';

/**
 * Internal identity verifier HTTP surface (STACK-2 option C). Plain `node:http`, no framework, so that no
 * layer can log or echo a request body. Properties:
 *  - never reachable from the edge: the compose file puts it on an internal-only network, no published port;
 *  - the caller proves itself with a shared secret (Authorization: Bearer), compared in constant time;
 *  - the body is size-limited while it is read, parsed once, never logged, buffers wiped after use
 *    (JavaScript strings cannot be wiped: best effort only, documented);
 *  - a hard deadline and an in-process throttle protect the verifier and, later, the ERP;
 *  - fail closed: every error path answers a minimal, credential-free JSON refusal.
 * Only the disabled implementation exists: the verdict is always the uniform denial.
 */

export interface VerifierServerOptions {
  readonly config: Pick<
    VerifierConfig,
    'sharedSecret' | 'bodyLimitBytes' | 'timeoutMs' | 'throttleMax' | 'throttleWindowMs' | 'maxConcurrency'
  >;
  readonly logger: Logger;
  readonly verification?: IdentityVerification;
  readonly now?: () => number;
}

const STATUS_BY_CODE = {
  unauthorized: 401,
  bad_request: 400,
  payload_too_large: 413,
  rate_limited: 429,
  unavailable: 503,
  not_found: 404,
} as const;

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Constant-time comparison of two secrets of any length (both are hashed first). */
export function secretsMatch(presented: string, expected: string): boolean {
  return timingSafeEqual(digest(presented), digest(expected));
}

function bearerToken(request: IncomingMessage): string {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return '';
  const match = /^Bearer (.+)$/.exec(header);
  return match?.[1] ?? '';
}

function send(response: ServerResponse, status: number, body: unknown, close: boolean): void {
  if (response.headersSent || response.writableEnded) return;
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...(close ? { connection: 'close' } : {}),
  });
  response.end(payload);
}

function fail(response: ServerResponse, code: keyof typeof STATUS_BY_CODE, close = false): void {
  const body: VerifyResponse = { ok: false, code };
  send(response, STATUS_BY_CODE[code], body, close);
}

class BodyTooLargeError extends Error {}

/** Reads the body up to `limit` bytes; the declared length is checked first, the stream count enforces it. */
function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(request.headers['content-length'] ?? '0');
    if (Number.isFinite(declared) && declared > limit) {
      reject(new BodyTooLargeError());
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        chunks.forEach((part) => part.fill(0));
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      chunks.forEach((part) => part.fill(0));
      resolve(body);
    });
    request.on('error', reject);
  });
}

async function withDeadline<T>(timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('verifier deadline exceeded'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createVerifierServer(options: VerifierServerOptions): Server {
  const { config, logger } = options;
  const verification = options.verification ?? disabledVerification;
  const expectedSecret = config.sharedSecret.reveal();
  const throttle = new VerifierThrottle(
    config.throttleMax,
    config.throttleWindowMs,
    config.maxConcurrency,
    options.now ?? Date.now,
  );

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const started = Date.now();
    const requestId = randomUUID();
    // Only the method and the path (never the query string, headers or body) are ever considered or logged.
    const path = (request.url ?? '').split('?')[0] ?? '';
    const finish = (outcome: string): void => {
      logger.info(
        { requestId, method: request.method, path: path === '/health' ? path : '/internal/verify', status: response.statusCode, outcome, ms: Date.now() - started },
        'verifier request',
      );
    };

    if (request.method === 'GET' && path === '/health') {
      send(response, 200, { status: 'ok' }, false);
      return;
    }
    if (request.method !== 'POST' || path !== '/internal/verify') {
      fail(response, 'not_found', true);
      request.resume();
      finish('not_found');
      return;
    }

    // Throttle first: it also bounds attempts to guess the shared secret.
    const release = throttle.tryAcquire();
    if (!release) {
      fail(response, 'rate_limited', true);
      request.resume();
      finish('rate_limited');
      return;
    }
    try {
      if (!secretsMatch(bearerToken(request), expectedSecret)) {
        fail(response, 'unauthorized', true);
        request.resume();
        finish('unauthorized');
        return;
      }

      let raw: Buffer;
      try {
        raw = await withDeadline(config.timeoutMs, () => readBody(request, config.bodyLimitBytes));
      } catch (error) {
        if (error instanceof BodyTooLargeError) {
          fail(response, 'payload_too_large', true);
          request.destroy();
          finish('payload_too_large');
        } else {
          fail(response, 'unavailable', true);
          request.destroy();
          finish('body_timeout');
        }
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString('utf8'));
      } catch {
        parsed = undefined;
      } finally {
        raw.fill(0);
      }
      const input = verifyRequestSchema.safeParse(parsed);
      if (!input.success) {
        // The zod issues are not echoed or logged: they can carry the offending value.
        fail(response, 'bad_request');
        finish('bad_request');
        return;
      }

      try {
        const verdict = await withDeadline(config.timeoutMs, (signal) => verification.verify(input.data, signal));
        if (verdict.ok) {
          // Unreachable while only the disabled verification exists; kept explicit so a future adapter has
          // exactly one success path and nothing else can answer success.
          send(response, 200, verdict, false);
          finish('verified');
        } else {
          send(response, 403, DENIAL, false);
          finish('denied');
        }
      } catch {
        // Timeout or adapter failure: not a credential verdict, never success, no detail to the caller.
        fail(response, 'unavailable');
        finish('unavailable');
      }
    } finally {
      release();
    }
  };

  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      fail(response, 'unavailable', true);
      logger.error({ outcome: 'internal_error' }, 'verifier request failed');
    });
  });
  // Slow-client protection; the body is tiny and the caller is the API on the internal network.
  server.headersTimeout = 5000;
  server.requestTimeout = Math.max(config.timeoutMs, 1000);
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 50;
  return server;
}
