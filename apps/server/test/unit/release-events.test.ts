import { describe, expect, it } from 'vitest';
import { erpStatusOf } from '../../src/orders/order.mapper.js';
import { decodeReleaseEventCodes, encodeReleaseEventCodes } from '../../src/orders/release-events.js';
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

  it('leaves the list-item status without events (no labels argument) and omits an empty list', () => {
    expect(erpStatusOf(order('2,13'))).not.toHaveProperty('releaseEvents');
    expect(erpStatusOf(order(null), {})).not.toHaveProperty('releaseEvents');
  });
});
