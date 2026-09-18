import { describe, expect, it } from 'vitest';
import {
  compareDecimalStrings,
  computeLineTotal,
  decimalEquals,
  isDecimalString,
  isTotalInRange,
  normalizeDecimalString,
  sumTotals,
  validateQuantity,
  validateUnitPrice,
} from '../src/index.js';

describe('validateQuantity', () => {
  it.each([
    ['1', '1'],
    ['2.5', '2.5'],
    ['2.5000', '2.5'],
    ['0.0001', '0.0001'],
    ['9999999999.9999', '9999999999.9999'],
    ['007', '7'],
  ])('accepts %s -> %s', (input, expected) => {
    expect(validateQuantity(input)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['0', 'not_positive'],
    ['0.0000', 'not_positive'],
    ['-1', 'negative'],
    ['-0.5', 'negative'],
    ['1.23456', 'too_many_decimals'],
    ['', 'not_a_decimal'],
    ['abc', 'not_a_decimal'],
    ['1,5', 'not_a_decimal'],
    [' 1', 'not_a_decimal'],
    ['1e3', 'not_a_decimal'],
    ['.5', 'not_a_decimal'],
    ['+1', 'not_a_decimal'],
    ['10000000000', 'out_of_range'],
  ])('rejects %j with %s', (input, error) => {
    expect(validateQuantity(input)).toEqual({ ok: false, error });
  });
});

describe('validateUnitPrice', () => {
  it.each([
    ['0', '0'],
    ['10', '10'],
    ['10.500000', '10.5'],
    ['0.000001', '0.000001'],
  ])('accepts %s -> %s', (input, expected) => {
    expect(validateUnitPrice(input)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['-0.01', 'negative'],
    ['1.1234567', 'too_many_decimals'],
    ['x', 'not_a_decimal'],
    ['1000000000000', 'out_of_range'],
  ])('rejects %j with %s', (input, error) => {
    expect(validateUnitPrice(input)).toEqual({ ok: false, error });
  });
});

describe('computeLineTotal (quantity x unit price, half-up to 2 decimals)', () => {
  it.each([
    // quantity, unit price, expected
    ['1', '10', '10.00'],
    ['3', '0.335', '1.01'], // 1.005 exact: floating point would give 1.00
    ['1', '0.005', '0.01'],
    ['1', '0.004999', '0.00'],
    ['1', '0.015', '0.02'],
    ['1', '0.025', '0.03'],
    ['1', '2.675', '2.68'],
    ['0.5', '0.01', '0.01'], // 0.005 -> up
    ['0.3333', '3', '1.00'], // 0.9999 -> 1.00
    ['1.5', '19.99', '29.99'], // 29.985 -> up
    ['1234.5678', '9876.543210', '12193262.22'],
    ['2', '0', '0.00'],
    ['1000000', '0.000001', '1.00'],
  ])('%s x %s = %s', (quantity, price, expected) => {
    expect(computeLineTotal(quantity, price)).toBe(expected);
  });

  it('is exact where binary floating point is not', () => {
    expect(0.1 * 3).not.toBe(0.3);
    expect(computeLineTotal('3', '0.1')).toBe('0.30');
    expect(computeLineTotal('1.1', '1.1')).toBe('1.21');
  });

  it('rejects malformed input by throwing', () => {
    expect(() => computeLineTotal('-1', '1')).toThrow(RangeError);
    expect(() => computeLineTotal('1', '1e2')).toThrow(RangeError);
  });
});

describe('sumTotals', () => {
  it('sums exactly and always has 2 decimals', () => {
    expect(sumTotals([])).toBe('0.00');
    expect(sumTotals(['0.10', '0.20'])).toBe('0.30');
    expect(sumTotals(['10.00', '0.01', '99999.99'])).toBe('100010.00');
  });
  it('rejects malformed items', () => {
    expect(() => sumTotals(['1.00', 'x'])).toThrow(RangeError);
  });
});

describe('decimal helpers', () => {
  it('detects well-formed strings', () => {
    expect(isDecimalString('1.50')).toBe(true);
    expect(isDecimalString('-1')).toBe(false);
    expect(isDecimalString('1.')).toBe(false);
  });
  it('normalizes and compares', () => {
    expect(normalizeDecimalString('10.500')).toBe('10.5');
    expect(compareDecimalStrings('2', '10')).toBe(-1);
    expect(compareDecimalStrings('10.0', '10')).toBe(0);
    expect(decimalEquals('1.10', '1.1')).toBe(true);
  });
  it('checks numeric(14,2) range', () => {
    expect(isTotalInRange('999999999999.99')).toBe(true);
    expect(isTotalInRange('1000000000000.00')).toBe(false);
  });
});
