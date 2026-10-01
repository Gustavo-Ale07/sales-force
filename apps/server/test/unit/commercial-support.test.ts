import { PgDialect } from 'drizzle-orm/pg-core';
import { erpCustomer } from '@salesforce/db';
import { describe, expect, it } from 'vitest';
import { orderFingerprint, type FingerprintInput } from '../../src/orders/order-fingerprint.js';
import { PG_INT_MAX, containsText, digitsOf, eqInt, escapeLike, fitsPgInt, inInts, inSellerCodes, offsetOf } from '../../src/platform/sql.js';

const dialect = new PgDialect();
const render = (fragment: Parameters<PgDialect['sqlToQuery']>[0]) => dialect.sqlToQuery(fragment);

const base: FingerprintInput = {
  customerCode: 40156,
  negotiationTypeCode: 2,
  notes: 'obs',
  items: [
    { productCode: 70001, quantity: '2' },
    { productCode: 70002, quantity: '3.5' },
  ],
};

describe('orderFingerprint', () => {
  it('is stable and hex SHA-256', () => {
    expect(orderFingerprint(base)).toBe(orderFingerprint({ ...base }));
    expect(orderFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('treats equivalent decimal spellings as the same content', () => {
    const spelled = { ...base, items: [{ productCode: 70001, quantity: '2.0000' }, { productCode: 70002, quantity: '3.50' }] };
    expect(orderFingerprint(spelled)).toBe(orderFingerprint(base));
  });

  it.each([
    ['customer', { ...base, customerCode: 40157 }],
    ['negotiation type', { ...base, negotiationTypeCode: 3 }],
    ['no negotiation type', { ...base, negotiationTypeCode: null }],
    ['notes', { ...base, notes: 'outra' }],
    ['no notes', { ...base, notes: null }],
    ['quantity', { ...base, items: [{ productCode: 70001, quantity: '3' }, base.items[1]!] }],
    ['product', { ...base, items: [{ productCode: 70009, quantity: '2' }, base.items[1]!] }],
    ['line order', { ...base, items: [base.items[1]!, base.items[0]!] }],
    ['fewer lines', { ...base, items: [base.items[0]!] }],
  ])('changes when the %s changes', (_name, changed) => {
    expect(orderFingerprint(changed)).not.toBe(orderFingerprint(base));
  });

  it('does not confuse null with the text "null"', () => {
    expect(orderFingerprint({ ...base, notes: null })).not.toBe(orderFingerprint({ ...base, notes: 'null' }));
  });

  it('never throws on a malformed quantity (validation reports it later)', () => {
    expect(() => orderFingerprint({ ...base, items: [{ productCode: 1, quantity: 'abc' }] })).not.toThrow();
  });
});

describe('platform/sql helpers', () => {
  it('fitsPgInt accepts only values a PostgreSQL integer can hold', () => {
    expect(fitsPgInt(0)).toBe(true);
    expect(fitsPgInt(PG_INT_MAX)).toBe(true);
    expect(fitsPgInt(PG_INT_MAX + 1)).toBe(false);
    expect(fitsPgInt(-1)).toBe(false);
    expect(fitsPgInt(1.5)).toBe(false);
    expect(fitsPgInt(Number.NaN)).toBe(false);
  });

  it('eqInt becomes "false" (never a database error) for an out-of-range code', () => {
    expect(render(eqInt(erpCustomer.code, 5)).sql).toContain('=');
    expect(render(eqInt(erpCustomer.code, PG_INT_MAX + 1)).sql).toBe('false');
  });

  it('inInts drops out-of-range values and matches nothing when none is left', () => {
    const query = render(inInts(erpCustomer.code, [1, 2, PG_INT_MAX + 5, 2]));
    expect(query.params).toEqual([1, 2]);
    expect(render(inInts(erpCustomer.code, [])).sql).toBe('false');
    expect(render(inInts(erpCustomer.code, [PG_INT_MAX + 1])).sql).toBe('false');
  });

  it('inSellerCodes never matches seller 0, negatives or fractions (F2)', () => {
    expect(render(inSellerCodes(erpCustomer.sellerCode, [0, -1, 1.5, 7, 7])).params).toEqual([7]);
    expect(render(inSellerCodes(erpCustomer.sellerCode, [0])).sql).toBe('false');
    expect(render(inSellerCodes(erpCustomer.sellerCode, [])).sql).toBe('false');
  });

  it('escapeLike neutralizes wildcards and the escape character', () => {
    expect(escapeLike('50%_off\\x')).toBe('50\\%\\_off\\\\x');
    expect(render(containsText(erpCustomer.name, '100%')).params).toEqual(['%100\\%%']);
  });

  it('digitsOf accepts punctuated numbers only', () => {
    expect(digitsOf('12.345.678/0001-99')).toBe('12345678000199');
    expect(digitsOf('123 456')).toBe('123456');
    expect(digitsOf('abc')).toBeNull();
    expect(digitsOf('12a')).toBeNull();
    expect(digitsOf('')).toBeNull();
  });

  it('offsetOf is zero-based', () => {
    expect(offsetOf(1, 25)).toBe(0);
    expect(offsetOf(3, 10)).toBe(20);
  });
});
