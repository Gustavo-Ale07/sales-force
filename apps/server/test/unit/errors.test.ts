import { NotFoundException, type ArgumentsHost } from '@nestjs/common';
import { ApiErrorSchema, ERROR_CODES, ERROR_HTTP_STATUS, type ErrorCode } from '@salesforce/contracts';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError, DEFAULT_ERROR_MESSAGES, formatIssuePath, validationError } from '../../src/http/app-error.js';
import {
  ApiExceptionFilter,
  buildErrorBody,
  codeForFrameworkStatus,
  resolveError,
} from '../../src/http/error-filter.js';

function fakeHost() {
  const sent: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
  const reply = {
    sent: false,
    status(code: number) {
      sent.status = code;
      return reply;
    },
    header(name: string, value: string) {
      sent.headers[name] = value;
      return reply;
    },
    send(body: unknown) {
      sent.body = body;
      return reply;
    },
  };
  const log = { error: vi.fn(), warn: vi.fn() };
  const request = { id: 'req-test-0001', log };
  const host = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }) } as unknown as ArgumentsHost;
  return { host, sent, log };
}

describe('error contract', () => {
  it('has a pt-BR message and an HTTP status for every code', () => {
    for (const code of ERROR_CODES) {
      expect(DEFAULT_ERROR_MESSAGES[code].length).toBeGreaterThan(10);
      expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
      expect(new AppError(code).status).toBe(ERROR_HTTP_STATUS[code]);
    }
  });

  it('maps framework statuses to contract codes', () => {
    const cases: [number, ErrorCode][] = [
      [400, 'validation_failed'],
      [401, 'unauthenticated'],
      [403, 'forbidden'],
      [404, 'not_found'],
      [405, 'not_found'],
      [409, 'conflict'],
      [413, 'validation_failed'],
      [415, 'validation_failed'],
      [429, 'rate_limited'],
      [500, 'internal_error'],
      [503, 'service_unavailable'],
    ];
    for (const [status, code] of cases) expect(codeForFrameworkStatus(status)).toBe(code);
  });

  it('builds validation issues from Zod without echoing submitted values', () => {
    const result = z.object({ email: z.string().email(), items: z.array(z.object({ qty: z.number().min(1) })) }).safeParse({
      email: 'secret-typed-value',
      items: [{ qty: 0 }],
    });
    if (result.success) throw new Error('expected failure');
    const error = validationError(result.error);
    expect(error.code).toBe('validation_failed');
    const paths = error.details?.issues?.map((issue) => issue.path);
    expect(paths).toEqual(['email', 'items[0].qty']);
    expect(JSON.stringify(error.details)).not.toContain('secret-typed-value');
    expect(formatIssuePath([])).toBe('(root)');
  });
});

describe('ApiExceptionFilter', () => {
  it('serves an AppError with its code, message, details and the request id', () => {
    const { host, sent, log } = fakeHost();
    new ApiExceptionFilter().catch(new AppError('installation_not_enabled'), host);
    expect(sent.status).toBe(409);
    expect(ApiErrorSchema.parse(sent.body)).toMatchObject({
      code: 'installation_not_enabled',
      message: DEFAULT_ERROR_MESSAGES.installation_not_enabled,
      details: { requestId: 'req-test-0001' },
    });
    expect(sent.headers['content-type']).toContain('application/json');
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('hides the message, stack and cause of an unexpected error and logs it in full', () => {
    const { host, sent, log } = fakeHost();
    const failure = new Error('select * from customers where cpf = 123 failed', {
      cause: new Error('password=hunter2'),
    });
    new ApiExceptionFilter().catch(failure, host);
    expect(sent.status).toBe(500);
    const text = JSON.stringify(sent.body);
    expect(text).not.toMatch(/select|hunter2|customers|stack|at /);
    expect(ApiErrorSchema.parse(sent.body)).toMatchObject({ code: 'internal_error', details: { requestId: 'req-test-0001' } });
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ err: failure, code: 'internal_error' }), 'request failed');
  });

  it('maps framework exceptions and never forwards their text', () => {
    const { host, sent } = fakeHost();
    new ApiExceptionFilter().catch(new NotFoundException('Cannot GET /internal/route-name'), host);
    expect(sent.status).toBe(404);
    expect(JSON.stringify(sent.body)).not.toContain('internal/route-name');
    expect(resolveError({ statusCode: 413, message: 'Request body is too large' }).code).toBe('validation_failed');
  });

  it('every code produces a body valid for the contract with the right status', () => {
    for (const code of ERROR_CODES) {
      const { host, sent } = fakeHost();
      new ApiExceptionFilter().catch(new AppError(code), host);
      expect(sent.status).toBe(ERROR_HTTP_STATUS[code]);
      expect(ApiErrorSchema.safeParse(sent.body).success).toBe(true);
    }
  });

  it('always includes the request id, even without details', () => {
    expect(buildErrorBody({ code: 'not_found', message: 'x', details: undefined }, 'abc-12345678').details).toEqual({
      requestId: 'abc-12345678',
    });
  });
});
