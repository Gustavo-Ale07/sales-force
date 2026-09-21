import { ApiErrorSchema, ERROR_HTTP_STATUS, type ApiError, type ErrorCode } from '@salesforce/contracts';
import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, DEFAULT_ERROR_MESSAGES, type AppErrorDetails } from './app-error.js';

/** Maps an HTTP status raised by the framework (routing, body parsing) to the closest error code. */
export function codeForFrameworkStatus(status: number): ErrorCode {
  switch (status) {
    case 401:
      return 'unauthenticated';
    case 403:
      return 'forbidden';
    case 404:
    case 405:
      return 'not_found';
    case 409:
      return 'conflict';
    case 429:
      return 'rate_limited';
    case 503:
      return 'service_unavailable';
    default:
      // 400, 413, 415, 422 and any other client error: the request itself is unusable.
      return status >= 400 && status < 500 ? 'validation_failed' : 'internal_error';
  }
}

function statusOf(error: unknown): number | undefined {
  if (error instanceof HttpException) return error.getStatus();
  // Fastify errors (invalid JSON body, payload too large, ...) carry a numeric `statusCode`.
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const value = (error as { statusCode: unknown }).statusCode;
    if (typeof value === 'number' && value >= 400 && value <= 599) return value;
  }
  return undefined;
}

export interface ResolvedError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details: AppErrorDetails | undefined;
}

/**
 * Turns anything thrown into a code, a user message and allowed details. Only `AppError` messages
 * and details reach the client; the message of any other error is replaced by the fixed pt-BR text
 * of its code, because it can hold internals.
 */
export function resolveError(error: unknown): ResolvedError {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, details: error.details };
  }
  const status = statusOf(error);
  const code: ErrorCode = status === undefined ? 'internal_error' : codeForFrameworkStatus(status);
  return { code, message: DEFAULT_ERROR_MESSAGES[code], details: undefined };
}

/** Builds the `ApiError` body; the request id is always present in `details.requestId`. */
export function buildErrorBody(resolved: ResolvedError, requestId: string): ApiError {
  return {
    code: resolved.code,
    message: resolved.message,
    details: { ...resolved.details, requestId },
  };
}

/**
 * Global exception filter: every failure leaves the API as the `ApiError` contract with the status
 * of its code (`ERROR_HTTP_STATUS`). No stack trace, cause, SQL or framework text is serialized.
 * Server errors are logged in full (with the correlation id, through the request logger); client
 * errors are logged at `warn` without a stack.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const resolved = resolveError(error);
    const status = ERROR_HTTP_STATUS[resolved.code];
    const body = buildErrorBody(resolved, request.id);

    // Belt and braces: the body must satisfy the published contract.
    ApiErrorSchema.parse(body);

    if (status >= 500) {
      request.log.error({ err: error, code: resolved.code }, 'request failed');
    } else {
      request.log.warn({ code: resolved.code, status }, 'request rejected');
    }

    if (reply.sent) return;
    void reply.status(status).header('content-type', 'application/json; charset=utf-8').send(body);
  }
}
