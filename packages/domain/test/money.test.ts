import { describe, expect, it } from 'vitest';
import {
  compareDecimalStrings,
  computeDiscountedLineTotal,
  computeLineDiscountAmount,
  computeUnitDiscount,
  estimateItemIpi,
  computeLineTotal,
  computeNetUnitPrice,
  decimalEquals,
  isDecimalString,
  isQuantityOnStep,
  isTotalInRange,
  normalizeDecimalString,
  sumQuantities,
  sumTotals,
  validateDiscountPercent,
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

describe('sumQuantities', () => {
  it('adds exactly, keeping up to 4 decimals and dropping trailing zeros', () => {
    expect(sumQuantities(['0.1', '0.2'])).toBe('0.3');
    expect(sumQuantities(['1.5', '2.5'])).toBe('4');
    expect(sumQuantities(['0.0001', '0.0002'])).toBe('0.0003');
  });
  it('sums an empty list to 0', () => {
    expect(sumQuantities([])).toBe('0');
  });
  it('rejects malformed input', () => {
    expect(() => sumQuantities(['abc'])).toThrow(RangeError);
    expect(() => sumQuantities(['-1'])).toThrow(RangeError);
  });
});

describe('discount', () => {
  it('validateDiscountPercent: 0 to 99.99 with at most 2 decimals', () => {
    expect(validateDiscountPercent('0')).toEqual({ ok: true, value: '0' });
    expect(validateDiscountPercent('7.50')).toEqual({ ok: true, value: '7.5' });
    expect(validateDiscountPercent('99.99')).toMatchObject({ ok: true });
    expect(validateDiscountPercent('100')).toEqual({ ok: false, error: 'out_of_range' });
    expect(validateDiscountPercent('1.234')).toEqual({ ok: false, error: 'too_many_decimals' });
    expect(validateDiscountPercent('-5')).toEqual({ ok: false, error: 'negative' });
  });

  it('computeDiscountedLineTotal equals computeLineTotal at 0% and follows the per-unit rounded Sankhya rule', () => {
    expect(computeDiscountedLineTotal('3', '0.335', '0')).toBe(computeLineTotal('3', '0.335'));
    expect(computeDiscountedLineTotal('1', '10.05', '50')).toBe('5.02'); // unit discount 5.025 -> 5.03
    expect(computeDiscountedLineTotal('7', '19.9', '33.33')).toBe('92.89'); // unit discount 6.632 -> 6.63
  });

  it('D-AK: the Sankhya discount rule on real Sandbox cases (notes 2499/2500, 2491/2492)', () => {
    expect(computeUnitDiscount('28.94', '8')).toBe('2.32');
    expect(computeLineDiscountAmount('10', '28.94', '8')).toBe('23.20');
    expect(computeDiscountedLineTotal('10', '28.94', '8')).toBe('266.20'); // the old one-shot rounding gave 266.25
    expect(computeUnitDiscount('118.26', '7')).toBe('8.28');
    expect(computeLineDiscountAmount('60', '118.26', '7')).toBe('496.80'); // VLRDESC, not 496.69
    expect(computeUnitDiscount('158.65', '7')).toBe('11.11');
    expect(computeLineDiscountAmount('15', '158.65', '7')).toBe('166.65');
    // order B: 4158 x 50 and 4159 x 10 at 8%
    const l1 = computeDiscountedLineTotal('50', '28.94', '8');
    const l2 = computeDiscountedLineTotal('10', '38.47', '8');
    expect(computeUnitDiscount('38.47', '8')).toBe('3.08'); // 3.0776
    expect(l1).toBe('1331.00');
    expect(l2).toBe('353.90');
    expect(sumTotals([l1, l2])).toBe('1684.90'); // old 1685.16
  });

  it('D-AK: IPI on the net line and the total (note 2500: 266.20 + 8.65 = 274.85)', () => {
    const net = computeDiscountedLineTotal('10', '28.94', '8');
    const ipi = estimateItemIpi(net, '3.25');
    expect(ipi).toBe('8.65');
    expect(sumTotals([net, ipi])).toBe('274.85');
    // order A, no discount: 4158 x 50 + 4159 x 10 -> IPI 47.03 + 12.50, total 1891.23
    const a1 = computeLineTotal('50', '28.94');
    const a2 = computeLineTotal('10', '38.47');
    expect(sumTotals([a1, a2, estimateItemIpi(a1, '3.25'), estimateItemIpi(a2, '3.25')])).toBe('1891.23');
  });

  it('computeNetUnitPrice: list - per-unit rounded discount, at most 6 decimals', () => {
    expect(computeNetUnitPrice('8', '10')).toBe('7.2');
    expect(computeNetUnitPrice('0.335', '12.5')).toBe('0.295');
    expect(computeNetUnitPrice('8', '0')).toBe('8');
  });
});

describe('isQuantityOnStep (AGRUPMIN, exact decimal arithmetic)', () => {
  it('laminates sold in multiples of 0.2', () => {
    expect(isQuantityOnStep('0.2', '0.2')).toBe(true);
    expect(isQuantityOnStep('0.6', '0.2')).toBe(true);
    expect(isQuantityOnStep('3', '0.2')).toBe(true);
    expect(isQuantityOnStep('0.3', '0.2')).toBe(false);
    expect(isQuantityOnStep('0.1', '0.2')).toBe(false);
  });
  it('no step (null, undefined, zero) means hundredths', () => {
    for (const step of [null, undefined, '0', '0.0000']) {
      expect(isQuantityOnStep('0.01', step)).toBe(true);
      expect(isQuantityOnStep('0.5', step)).toBe(true);
      expect(isQuantityOnStep('4158', step)).toBe(true);
      expect(isQuantityOnStep('0.005', step)).toBe(false);
      expect(isQuantityOnStep('0.0001', step)).toBe(false);
    }
  });
  it('a malformed quantity is on no step', () => {
    expect(isQuantityOnStep('abc', '0.2')).toBe(false);
    expect(isQuantityOnStep('', null)).toBe(false);
  });
});
