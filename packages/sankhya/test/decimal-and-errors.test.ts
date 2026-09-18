import { describe, expect, it } from 'vitest';
import { canonicalDecimal, decimalFromCell, fixedToDecimal } from '../src/decimal.js';
import {
  NotImplementedError,
  SANKHYA_ERROR_KINDS,
  SankhyaGatewayError,
  classifyHttpFailure,
  isRetryable,
  isRetryableKind,
  parseRetryAfterMs,
} from '../src/index.js';

describe('decimal helpers', () => {
  it('canonicalizes plain unsigned decimals', () => {
    expect(canonicalDecimal('16.4300')).toBe('16.43');
    expect(canonicalDecimal('0.0')).toBe('0');
    expect(canonicalDecimal('007')).toBe('7');
    expect(canonicalDecimal('1234.5678')).toBe('1234.5678');
  });

  it('rejects malformed and out-of-range text', () => {
    for (const text of ['', '-1', '1e3', '1,5', '.5', '5.', 'abc', '1.1234567', '1234567890123']) {
      expect(canonicalDecimal(text), text).toBeNull();
    }
  });

  it('reads numeric cells without exponent leaks and reports the problem', () => {
    expect(decimalFromCell(16.43)).toEqual({ ok: true, value: '16.43' });
    expect(decimalFromCell('0.10')).toEqual({ ok: true, value: '0.1' });
    expect(decimalFromCell(0)).toEqual({ ok: true, value: '0' });
    expect(decimalFromCell(-1)).toEqual({ ok: false, problem: 'negative' });
    expect(decimalFromCell('-0.5')).toEqual({ ok: false, problem: 'negative' });
    expect(decimalFromCell(Number.NaN)).toEqual({ ok: false, problem: 'not_a_number' });
    expect(decimalFromCell(null)).toEqual({ ok: false, problem: 'not_a_number' });
    expect(decimalFromCell(1e-7)).toEqual({ ok: false, problem: 'out_of_range' });
  });

  it('builds fixed-scale decimals', () => {
    expect(fixedToDecimal(1643, 2)).toBe('16.43');
    expect(fixedToDecimal(0, 4)).toBe('0');
    expect(fixedToDecimal(5, 4)).toBe('0.0005');
    expect(() => fixedToDecimal(-1, 2)).toThrow(RangeError);
    expect(() => fixedToDecimal(1.5, 2)).toThrow(RangeError);
  });
});

describe('error taxonomy', () => {
  it('derives retryability from the kind only', () => {
    const retryable = SANKHYA_ERROR_KINDS.filter((kind) => isRetryableKind(kind));
    expect(retryable).toEqual(['unavailable', 'rate_limit', 'temporary']);
    for (const kind of SANKHYA_ERROR_KINDS) {
      expect(new SankhyaGatewayError(kind, { code: 'x', message: 'm' }).retryable).toBe(isRetryableKind(kind));
    }
  });

  it('never treats unknown errors or NotImplemented as retryable', () => {
    expect(isRetryable(new Error('boom'))).toBe(false);
    expect(isRetryable('x')).toBe(false);
    expect(isRetryable(new NotImplementedError('x - NEEDS VALIDATION S9'))).toBe(false);
  });

  it('classifies HTTP statuses', () => {
    expect(classifyHttpFailure(401, 'c').kind).toBe('auth');
    expect(classifyHttpFailure(403, 'c').kind).toBe('auth');
    expect(classifyHttpFailure(429, 'c', 1500)).toMatchObject({ kind: 'rate_limit', retryAfterMs: 1500 });
    expect(classifyHttpFailure(503, 'c').kind).toBe('unavailable');
    expect(classifyHttpFailure(500, 'c').kind).toBe('temporary');
    expect(classifyHttpFailure(408, 'c').kind).toBe('temporary');
    expect(classifyHttpFailure(400, 'c').kind).toBe('validation');
    expect(classifyHttpFailure(404, 'c').kind).toBe('permanent');
    expect(classifyHttpFailure(301, 'c')).toMatchObject({ kind: 'permanent', code: 'unexpected_redirect' });
  });

  it('parses Retry-After seconds only', () => {
    expect(parseRetryAfterMs('7')).toBe(7000);
    expect(parseRetryAfterMs(' 0 ')).toBe(0);
    expect(parseRetryAfterMs('Wed, 21 Oct 2026 07:28:00 GMT')).toBeUndefined();
    expect(parseRetryAfterMs('-3')).toBeUndefined();
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
  });
});
