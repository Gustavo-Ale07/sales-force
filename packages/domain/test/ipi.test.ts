import { describe, expect, it } from 'vitest';
import { classifyItemIpi, computeDiscountedLineTotal, computeOrderIpi, computeOrderIpiFromRefs, estimateItemIpi, type IpiRate } from '../src/index.js';

const rates = new Map<number, IpiRate>([
  [5, { code: 5, percentual: '3.25', byTariff: false, description: 'x' }],
  [6, { code: 6, percentual: '9.75', byTariff: false, description: 'x' }],
  [7, { code: 7, percentual: '5', byTariff: true, description: 'x' }],
]);

describe('estimateItemIpi', () => {
  it('rounds half-up once to 2 decimals', () => {
    expect(estimateItemIpi('16.43', '9.75')).toBe('1.60');
    expect(estimateItemIpi('100.00', '3.25')).toBe('3.25');
    expect(estimateItemIpi('0.00', '9.75')).toBe('0.00');
    expect(estimateItemIpi('10.00', '0.05')).toBe('0.01');
  });
  it('zero rate gives zero', () => {
    expect(estimateItemIpi('50.00', '0')).toBe('0.00');
  });
  it('throws on malformed input', () => {
    expect(() => estimateItemIpi('x', '1')).toThrow(RangeError);
  });
});

describe('classifyItemIpi', () => {
  it('product 4158 (code 5) at 3.25%', () => {
    expect(classifyItemIpi('200.00', 5, rates)).toEqual({ status: 'estimated', amount: '6.50', percentual: '3.25' });
  });
  it('products 13 and 2804 (code 6) at 9.75%', () => {
    expect(classifyItemIpi('16.43', 6, rates)).toEqual({ status: 'estimated', amount: '1.60', percentual: '9.75' });
  });
  it('product without IPI code is unavailable, never zero', () => {
    expect(classifyItemIpi('16.43', null, rates)).toEqual({ status: 'unavailable' });
  });
  it('code without a rate in the mirror is unavailable', () => {
    expect(classifyItemIpi('16.43', 99, rates)).toEqual({ status: 'unavailable' });
  });
  it('tariff (pauta) IPI is not estimated', () => {
    expect(classifyItemIpi('16.43', 7, rates)).toEqual({ status: 'tariff' });
  });
  it('unpriced line is unavailable', () => {
    expect(classifyItemIpi(null, 6, rates)).toEqual({ status: 'unavailable' });
  });
});

describe('grand total equals the ERP note total (D-AK): sum of net lines + IPI per line', () => {
  const total = (discountPercent: string) => {
    const net = computeDiscountedLineTotal('3', '8.20', discountPercent);
    return { net, ...computeOrderIpi([{ lineNetTotal: net, ipiCode: 5 }], net, rates) };
  };

  it('without discount: 24.60 + 0.80 = 25.40 (order 2507)', () => {
    const r = total('0');
    expect(r.net).toBe('24.60');
    expect(r.ipiEstimated).toBe('0.80');
    expect(r.grandTotalEstimated).toBe('25.40');
  });

  it('with discount: IPI is taken on the net line (3 x (8.20 - 0.41) = 23.37; IPI 0.76; total 24.13)', () => {
    const r = total('5');
    expect(r.net).toBe('23.37');
    expect(r.ipiEstimated).toBe('0.76');
    expect(r.grandTotalEstimated).toBe('24.13');
  });
});

describe('computeOrderIpi', () => {
  it('sums estimated IPI per line and adds it to the net total', () => {
    const result = computeOrderIpi(
      [
        { lineNetTotal: '16.43', ipiCode: 6 },
        { lineNetTotal: '200.00', ipiCode: 5 },
      ],
      '216.43',
      rates,
    );
    expect(result.ipiEstimated).toBe('8.10');
    expect(result.grandTotalEstimated).toBe('224.53');
    expect(result.unavailableLineCount).toBe(0);
    expect(result.tariffLineCount).toBe(0);
    expect(result.isPartial).toBe(false);
  });
  it('flags unavailable and tariff lines without a silent zero', () => {
    const result = computeOrderIpi(
      [
        { lineNetTotal: '10.00', ipiCode: null },
        { lineNetTotal: '10.00', ipiCode: 7 },
        { lineNetTotal: '10.00', ipiCode: 6 },
      ],
      '30.00',
      rates,
    );
    expect(result.ipiEstimated).toBe('0.98');
    expect(result.grandTotalEstimated).toBe('30.98');
    expect(result.unavailableLineCount).toBe(1);
    expect(result.tariffLineCount).toBe(1);
    expect(result.isPartial).toBe(true);
    expect(result.lines.map((l) => l.status)).toEqual(['unavailable', 'tariff', 'estimated']);
  });
});

describe('code without a rate in the ERP (rateMissing, H1)', () => {
  const withExempt = new Map<number, IpiRate>([...rates, [8, { code: 8, percentual: '0.00', byTariff: false, description: 'x', rateMissing: true }]]);

  it('is estimated at 0.00 and marked exempt, not unavailable', () => {
    expect(classifyItemIpi('16.43', 8, withExempt)).toEqual({ status: 'exempt', amount: '0.00' });
  });
  it('an unpriced line stays unavailable', () => {
    expect(classifyItemIpi(null, 8, withExempt)).toEqual({ status: 'unavailable' });
  });
  it('tariff wins over a missing rate', () => {
    const both = new Map<number, IpiRate>([[9, { code: 9, percentual: '0.00', byTariff: true, description: 'x', rateMissing: true }]]);
    expect(classifyItemIpi('10.00', 9, both)).toEqual({ status: 'tariff' });
  });
  it('does not count as unavailable nor make the order partial', () => {
    const result = computeOrderIpi(
      [
        { lineNetTotal: '200.00', ipiCode: 5 },
        { lineNetTotal: '10.00', ipiCode: 8 },
      ],
      '210.00',
      withExempt,
    );
    expect(result).toMatchObject({ ipiEstimated: '6.50', grandTotalEstimated: '216.50', unavailableLineCount: 0, exemptLineCount: 1, isPartial: false });
    expect(result.lines.map((l) => l.status)).toEqual(['estimated', 'exempt']);
  });
  it('the client reference path gives the same result', () => {
    const result = computeOrderIpiFromRefs([{ lineNetTotal: '10.00', ref: { status: 'exempt' } }], '10.00');
    expect(result).toMatchObject({ ipiEstimated: '0.00', exemptLineCount: 1, unavailableLineCount: 0, isPartial: false });
  });
});

describe('computeOrderIpiFromRefs (client side: the product carries its reference)', () => {
  it('matches the rate-table path', () => {
    const result = computeOrderIpiFromRefs(
      [
        { lineNetTotal: '16.43', ref: { status: 'rate', percentual: '9.75' } },
        { lineNetTotal: '10.00', ref: { status: 'tariff' } },
        { lineNetTotal: null, ref: { status: 'rate', percentual: '3.25' } },
      ],
      '26.43',
    );
    expect(result.ipiEstimated).toBe('1.60');
    expect(result.grandTotalEstimated).toBe('28.03');
    expect(result).toMatchObject({ tariffLineCount: 1, unavailableLineCount: 1, isPartial: true });
  });
});
