import { describe, expect, it } from 'vitest';
import {
  computeDiscountedLineTotal,
  computeLineDiscountAmount,
  computeLineTotal,
  estimateItemIpi,
  sumTotals,
} from '../src/index.js';

/**
 * Golden cases from real Vidya lines (production, read 2026-11-10), D-AK formula:
 *   line discount = qty x ROUND(unit price x discount% / 100, 2)
 *   net line  = qty x (unit price - rounded unit discount)
 *   IPI       = rate x net line, 2 places (rate 3.25 when the product has IPI)
 *   gross     = qty x rounded unit price
 * These pin the existing formulas; they must never be "adjusted" to pass.
 */
const IPI_RATE = '3.25';

interface Golden {
  readonly name: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly discount: string;
  readonly discountAmount: string;
  readonly gross: string;
  readonly net: string;
  readonly ipi: string;
}

const CASES: readonly Golden[] = [
  { name: '1 x 257.62 at 10%', quantity: '1', unitPrice: '257.62', discount: '10', discountAmount: '25.76', gross: '257.62', net: '231.86', ipi: '7.54' },
  { name: '1 x 257.62 at 5%', quantity: '1', unitPrice: '257.62', discount: '5', discountAmount: '12.88', gross: '257.62', net: '244.74', ipi: '7.95' },
  { name: '2 x 257.62 at 5%', quantity: '2', unitPrice: '257.62', discount: '5', discountAmount: '25.76', gross: '515.24', net: '489.48', ipi: '15.91' },
  { name: '1 x 236.88 at 10%', quantity: '1', unitPrice: '236.88', discount: '10', discountAmount: '23.69', gross: '236.88', net: '213.19', ipi: '6.93' },
  { name: '0.5 x 257.62 at 5% (fraction)', quantity: '0.5', unitPrice: '257.62', discount: '5', discountAmount: '6.44', gross: '128.81', net: '122.37', ipi: '3.98' },
  { name: '0.2 x 236.88 at 0% (fraction, no discount)', quantity: '0.2', unitPrice: '236.88', discount: '0', discountAmount: '0.00', gross: '47.38', net: '47.38', ipi: '1.54' },
];

describe('Vidya golden lines (D-AK)', () => {
  it.each(CASES)('$name', (c) => {
    expect(computeLineDiscountAmount(c.quantity, c.unitPrice, c.discount)).toBe(c.discountAmount);
    expect(computeLineTotal(c.quantity, c.unitPrice)).toBe(c.gross);
    const net = computeDiscountedLineTotal(c.quantity, c.unitPrice, c.discount);
    expect(net).toBe(c.net);
    expect(estimateItemIpi(net, IPI_RATE)).toBe(c.ipi);
  });

  it('order E (the two fractional lines): net 169.75, IPI 5.52, note total 175.27 (freight FOB is not in the total)', () => {
    const lines = CASES.slice(4);
    const nets = lines.map((c) => computeDiscountedLineTotal(c.quantity, c.unitPrice, c.discount));
    const ipis = nets.map((n) => estimateItemIpi(n, IPI_RATE));
    const net = sumTotals(nets);
    const ipi = sumTotals(ipis);
    expect(net).toBe('169.75');
    expect(ipi).toBe('5.52');
    expect(sumTotals([net, ipi])).toBe('175.27');
  });
});
