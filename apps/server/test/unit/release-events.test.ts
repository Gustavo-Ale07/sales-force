import { describe, expect, it } from 'vitest';
import { erpReleaseOf, erpStatusOf } from '../../src/orders/order.mapper.js';
import { decodeReleaseDetail, decodeReleaseEventCodes, encodeReleaseDetail, encodeReleaseEventCodes, storedReleaseState } from '../../src/orders/release-events.js';
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
