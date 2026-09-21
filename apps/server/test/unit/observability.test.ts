import { Secret } from '@salesforce/sankhya';
import { describe, expect, it } from 'vitest';
import { createLogger, REDACTED_PLACEHOLDER } from '../../src/observability/logger.js';
import {
  isAcceptableRequestId,
  resolveRequestId,
  runWithLogContext,
} from '../../src/observability/request-context.js';
import { captureLogs } from '../helpers/postgres.js';

describe('request id', () => {
  it('accepts a well-formed inbound id', () => {
    expect(resolveRequestId('req-1234:abc.DEF_9')).toBe('req-1234:abc.DEF_9');
    expect(resolveRequestId(['first-request-id', 'second'])).toBe('first-request-id');
  });

  it('generates one when missing or malformed (log injection, size, control characters)', () => {
    for (const bad of [undefined, '', 'short', 'has space in it', 'line\nbreak-injection', 'x'.repeat(129), '<script>alert(1)</script>']) {
      const generated = resolveRequestId(bad);
      expect(generated).toMatch(/^[0-9a-f-]{36}$/);
      expect(isAcceptableRequestId(generated)).toBe(true);
    }
    expect(resolveRequestId(undefined)).not.toBe(resolveRequestId(undefined));
  });
});

describe('logger', () => {
  it('writes structured JSON with the service label and the correlation context', () => {
    const capture = captureLogs();
    const logger = createLogger({ level: 'info', service: 'api', destination: capture.stream });
    runWithLogContext({ requestId: 'req-correlation-1' }, () => logger.info({ n: 1 }, 'inside'));
    logger.info('outside');
    const [inside, outside] = capture.lines();
    expect(inside).toMatchObject({ service: 'api', msg: 'inside', requestId: 'req-correlation-1', n: 1 });
    expect(typeof inside?.['time']).toBe('string');
    expect(outside).toMatchObject({ msg: 'outside' });
    expect(outside).not.toHaveProperty('requestId');
  });

  it('redacts credentials at any depth, including hyphenated header names', () => {
    const capture = captureLogs();
    const logger = createLogger({ level: 'info', service: 'api', destination: capture.stream });
    const leaked = 'leaked-value-123';
    logger.info(
      {
        password: leaked,
        token: leaked,
        secret: leaked,
        authorization: `Bearer ${leaked}`,
        headers: { cookie: leaked, 'x-token': leaked, authorization: leaked, 'set-cookie': leaked },
        nested: { deeper: { config: { clientSecret: leaked, 'x-token': leaked } } },
        body: { newPassword: leaked, currentPassword: leaked },
        connectionString: `postgres://u:${leaked}@h/db`,
      },
      'redaction',
    );
    const [line] = capture.lines();
    expect(JSON.stringify(line)).not.toContain(leaked);
    expect(line).toMatchObject({ password: REDACTED_PLACEHOLDER, headers: { 'x-token': REDACTED_PLACEHOLDER } });
  });

  it('serializes a Secret as redacted and keeps only method and path of a request', () => {
    const capture = captureLogs();
    const logger = createLogger({ level: 'info', service: 'api', destination: capture.stream });
    logger.info({ url: new Secret('postgres://u:pw-value-9@h/db') }, 'secret');
    logger.info({ req: { method: 'GET', url: '/api/v1/x?token=abc123&q=1', headers: { authorization: 'x' } } }, 'request');
    const [secretLine, requestLine] = capture.lines();
    expect(JSON.stringify(secretLine)).not.toContain('pw-value-9');
    expect(requestLine?.['req']).toEqual({ method: 'GET', url: '/api/v1/x' });
  });

  it('serializes errors with type and stack for operators', () => {
    const capture = captureLogs();
    const logger = createLogger({ level: 'info', service: 'api', destination: capture.stream });
    logger.error({ err: new Error('boom') }, 'failed');
    const [line] = capture.lines();
    expect(line?.['err']).toMatchObject({ type: 'Error', message: 'boom' });
  });
});
