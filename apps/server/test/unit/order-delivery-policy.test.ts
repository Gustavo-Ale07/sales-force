import { SankhyaGatewayError } from '@salesforce/sankhya';
import { describe, expect, it } from 'vitest';
import {
  AUTH_RETRY_DELAY_MS,
  MAX_DELIVERY_ATTEMPTS,
  backoffMs,
  decideFailure,
  type FailureFacts,
} from '../../src/integration/order-delivery.policy.js';

const err = (kind: ConstructorParameters<typeof SankhyaGatewayError>[0], retryAfterMs?: number) =>
  new SankhyaGatewayError(kind, { code: `c_${kind}`, message: 'x', ...(retryAfterMs === undefined ? {} : { retryAfterMs }) });

const facts = (over: Partial<FailureFacts> = {}): FailureFacts => ({
  phase: 'include',
  attemptCount: 1,
  mayExist: false,
  hasErpNumber: false,
  ...over,
});

describe('backoffMs (D-2)', () => {
  it('doubles from 30 s and is capped at 15 min', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(backoffMs)).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 900_000, 900_000, 900_000]);
  });
});

describe('decideFailure', () => {
  it.each(['validation', 'permanent'] as const)('%s at include is final: rejected, never retried', (kind) => {
    expect(decideFailure(err(kind), facts())).toEqual({ kind: 'reject', errorClass: kind, errorCode: `c_${kind}` });
  });

  it('a refusal at include stays final even after an earlier ambiguous attempt (origin check proved absence)', () => {
    expect(decideFailure(err('validation'), facts({ mayExist: true })).kind).toBe('reject');
  });

  it('a duplicate origin in the ERP parks the order for a person, never rejects it', () => {
    const duplicate = new SankhyaGatewayError('permanent', { code: 'duplicate_origin', message: 'x' });
    expect(decideFailure(duplicate, facts({ phase: 'verify' })).kind).toBe('park');
  });

  it('a permanent failure while verifying a possibly-sent order parks it instead of rejecting a real order', () => {
    expect(decideFailure(err('permanent'), facts({ phase: 'verify', mayExist: true })).kind).toBe('park');
    expect(decideFailure(err('permanent'), facts({ phase: 'verify', mayExist: false })).kind).toBe('reject');
  });

  it('a refusal at confirmation or reread parks: the order exists in the ERP', () => {
    for (const phase of ['confirm', 'reread'] as const) {
      expect(decideFailure(err('validation'), facts({ phase, mayExist: true, hasErpNumber: true })).kind).toBe('park');
    }
  });

  it('auth retries slowly without consuming an attempt', () => {
    expect(decideFailure(err('auth'), facts({ attemptCount: 3 }))).toEqual({
      kind: 'retry',
      status: 'pending',
      delayMs: AUTH_RETRY_DELAY_MS,
      consumesAttempt: false,
      errorClass: 'auth',
      errorCode: 'c_auth',
    });
    expect(decideFailure(err('auth'), facts({ mayExist: true }))).toMatchObject({ status: 'unknown' });
  });

  it.each(['unavailable', 'temporary'] as const)('%s at include is ambiguous: unknown, backoff, re-verify by origin', (kind) => {
    expect(decideFailure(err(kind), facts({ attemptCount: 2 }))).toMatchObject({
      kind: 'retry',
      status: 'unknown',
      delayMs: 60_000,
      consumesAttempt: true,
    });
  });

  it('a temporary failure while only verifying keeps the row pending (nothing was sent)', () => {
    expect(decideFailure(err('unavailable'), facts({ phase: 'verify' }))).toMatchObject({ kind: 'retry', status: 'pending' });
    expect(decideFailure(err('unavailable'), facts({ phase: 'verify', mayExist: true }))).toMatchObject({ kind: 'retry', status: 'unknown' });
  });

  it('rate limit honors Retry-After when longer than the backoff and keeps an unsent row pending', () => {
    expect(decideFailure(err('rate_limit', 120_000), facts())).toMatchObject({ kind: 'retry', status: 'pending', delayMs: 120_000 });
    expect(decideFailure(err('rate_limit', 1_000), facts())).toMatchObject({ delayMs: 30_000 });
  });

  it('exhausted attempts on a temporary error reject with class "exhausted" (D-2)', () => {
    expect(decideFailure(err('temporary'), facts({ attemptCount: MAX_DELIVERY_ATTEMPTS }))).toEqual({
      kind: 'reject',
      errorClass: 'exhausted',
      errorCode: 'c_temporary',
    });
  });

  it('exhausted attempts when the ERP number is known park it, never calling an included order a failed send (D-4)', () => {
    expect(decideFailure(err('temporary'), facts({ phase: 'confirm', attemptCount: MAX_DELIVERY_ATTEMPTS, mayExist: true, hasErpNumber: true })).kind).toBe('park');
  });

  it('an unclassified error is treated as ambiguous and retried (it may have happened after the send)', () => {
    expect(decideFailure(new TypeError('boom'), facts())).toMatchObject({ kind: 'retry', status: 'unknown', errorClass: 'unclassified' });
  });
});
