import { describe, expect, it } from 'vitest';
import { erpReleaseOf, erpStatusOf } from '../../src/orders/order.mapper.js';
import { decodeReleaseDetail, decodeReleaseEventCodes, encodeReleaseDetail, encodeReleaseEventCodes, storedBillingState, storedReleaseState } from '../../src/orders/release-events.js';
import type { OrderRow } from '../../src/orders/orders.repository.js';

const order = (detail: string | null): OrderRow =>
  ({
    erpStatusCode: 1,
    erpStatusLabel: 'PENDENTE',
    erpInvoiceNumber: null,
    erpStatusCheckedAt: new Date('2026-10-30T12:00:00.000Z'),
    erpStatusDetail: detail,
  }) as unknown as OrderRow;

describe('release event codes (D6b)', () => {
  it('encodes distinct ascending codes and null when empty', () => {
    expect(encodeReleaseEventCodes([44, 2, 13, 2])).toBe('2,13,44');
    expect(encodeReleaseEventCodes([])).toBeNull();
    expect(encodeReleaseEventCodes([-1, 1.5])).toBeNull();
  });

  it('decodes and drops unreadable parts', () => {
    expect(decodeReleaseEventCodes('2,13,44')).toEqual([2, 13, 44]);
    expect(decodeReleaseEventCodes(null)).toEqual([]);
    expect(decodeReleaseEventCodes('')).toEqual([]);
    expect(decodeReleaseEventCodes('2,x,5')).toEqual([2, 5]);
  });

  it('adds the events to the detail status with configured names and null for unnamed codes', () => {
    const status = erpStatusOf(order('2,13'), { '2': 'Liberacao comercial' });
    expect(status?.releaseEvents).toEqual([
      { code: 2, label: 'Liberacao comercial' },
      { code: 13, label: null },
    ]);
  });

  it('stores the release lines as versioned JSON without any user and decodes them back', () => {
    const at = new Date('2026-11-10T12:00:00.000Z');
    const text = encodeReleaseDetail(
      [
        { event: 44, description: 'Exigida pela TOP', released: false, denied: false },
        { event: 3, description: null, released: true, denied: false },
      ],
      at,
    );
    expect(text).not.toBeNull();
    expect(text).not.toMatch(/user|usu/i);
    const detail = decodeReleaseDetail(text);
    expect(detail?.checkedAt).toBe(at.toISOString());
    expect(detail?.lines).toEqual([
      { code: 3, description: null, state: 'released' },
      { code: 44, description: 'Exigida pela TOP', state: 'awaiting' },
    ]);
    expect(encodeReleaseDetail([], at)).toBeNull();
    expect(decodeReleaseEventCodes(text)).toEqual([3, 44]);
  });

  it('stores billing in the v2 form, keeps v1 without it, and round-trips items and the invoicing date', () => {
    const at = new Date('2026-11-10T12:00:00.000Z');
    const lines = [{ event: 3, description: null, released: true, denied: false }];
    const billing = {
      state: 'invoiced' as const,
      invoicedAt: '2026-11-09',
      nfeAuthorized: true,
      items: [{ sequence: 1, productCode: 4158, invoiced: '4', cut: '6' }],
    };
    const v1 = JSON.parse(encodeReleaseDetail(lines, at) ?? '{}') as { v: number; b?: unknown };
    expect(v1.v).toBe(1);
    expect(v1.b).toBeUndefined();
    const text = encodeReleaseDetail(lines, at, billing);
    expect((JSON.parse(text ?? '{}') as { v: number }).v).toBe(2);
    expect(decodeReleaseDetail(text)?.billing).toEqual(billing);
    expect(storedBillingState(decodeReleaseDetail(text))).toBe('invoiced');
    expect(storedBillingState(decodeReleaseDetail(encodeReleaseDetail(lines, at)))).toBeNull();
    // Billing alone (no release lines) is still a detail.
    const alone = encodeReleaseDetail([], at, { state: 'cancelled', invoicedAt: null, nfeAuthorized: false, items: [] });
    expect(decodeReleaseDetail(alone)?.billing?.state).toBe('cancelled');
    // Unknown state and malformed items are dropped, not trusted.
    const odd = decodeReleaseDetail('{"v":2,"at":"x","l":[{"c":3,"s":"l"}],"b":{"s":"weird","i":[[1,2,"3"],[1,2,"3","4"],"x"]}}');
    expect(odd?.billing).toEqual({ state: null, invoicedAt: null, nfeAuthorized: false, items: [{ sequence: 1, productCode: 2, invoiced: '3', cut: '4' }] });
  });

  it('ignores the legacy codes and garbage as a release detail', () => {
    expect(decodeReleaseDetail('2,13')).toBeNull();
    expect(decodeReleaseDetail('{broken')).toBeNull();
    expect(decodeReleaseDetail('{"v":2,"at":"x","l":[]}')).toBeNull();
    expect(decodeReleaseDetail(null)).toBeNull();
  });

  it('derives the order release state: denied wins, then awaiting, then released', () => {
    const detail = (states: Array<'a' | 'l' | 'd'>) => decodeReleaseDetail(JSON.stringify({ v: 1, at: 'x', l: states.map((s, i) => ({ c: i, s })) }));
    expect(storedReleaseState(detail(['l', 'l'])!)).toBe('released');
    expect(storedReleaseState(detail(['l', 'a'])!)).toBe('awaiting');
    expect(storedReleaseState(detail(['a', 'd', 'l'])!)).toBe('denied');
  });

  it('maps erpRelease on the list (state only) and on the detail (with events); null without a stored release', () => {
    const stored = encodeReleaseDetail([{ event: 44, description: 'Exigida pela TOP', released: false, denied: false }], new Date('2026-11-10T12:00:00.000Z'));
    const row = order(stored);
    expect(erpReleaseOf(row)).toEqual({ state: 'awaiting', checkedAt: '2026-11-10T12:00:00.000Z' });
    expect(erpReleaseOf(row, true)).toEqual({
      state: 'awaiting',
      checkedAt: '2026-11-10T12:00:00.000Z',
      events: [{ code: 44, label: 'Exigida pela TOP', state: 'awaiting' }],
    });
    expect(erpReleaseOf(order(null))).toBeNull();
    expect(erpReleaseOf(order('2,13'))).toBeNull();
  });

  it('leaves the list-item status without events (no labels argument) and omits an empty list', () => {
    expect(erpStatusOf(order('2,13'))).not.toHaveProperty('releaseEvents');
    expect(erpStatusOf(order(null), {})).not.toHaveProperty('releaseEvents');
  });
});
