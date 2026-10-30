import { describe, expect, it } from 'vitest';
import { orderErpIssues, type OrderErpLine } from '../src/order-erp-validation.js';

const line = (over: Partial<OrderErpLine> = {}): OrderErpLine => ({
  lineNo: 1,
  discountPercent: '0',
  priceState: 'priced',
  unit: 'UN',
  ...over,
});

describe('orderErpIssues (structural validity before queuing, SNK-7)', () => {
  it('accepts priced lines with a unit and a discount from 0 to 99.99', () => {
    expect(orderErpIssues([line(), line({ lineNo: 2, discountPercent: '8' }), line({ lineNo: 3, discountPercent: '99.99' })])).toEqual([]);
  });

  it('refuses an order without lines', () => {
    expect(orderErpIssues([])).toEqual([{ code: 'no_items', lineNo: 0 }]);
  });

  it.each(['100', '99.991', '-1', '-0.01', 'abc', ''])('refuses the discount %j', (discountPercent) => {
    expect(orderErpIssues([line({ discountPercent })])).toEqual([{ code: 'discount_out_of_range', lineNo: 1 }]);
  });

  it('a missing price is "Sem preço" and a zero price is its own issue; neither is ever sendable', () => {
    expect(orderErpIssues([line({ priceState: 'none' })])).toEqual([{ code: 'no_price', lineNo: 1 }]);
    expect(orderErpIssues([line({ priceState: 'zero' })])).toEqual([{ code: 'zero_price', lineNo: 1 }]);
  });

  it('refuses a missing or blank unit of measure', () => {
    expect(orderErpIssues([line({ unit: null }), line({ lineNo: 2, unit: '  ' })])).toEqual([
      { code: 'missing_unit', lineNo: 1 },
      { code: 'missing_unit', lineNo: 2 },
    ]);
  });

  it('reports every problem of every line, in line order', () => {
    expect(orderErpIssues([line({ lineNo: 1, discountPercent: '120', priceState: 'none' }), line({ lineNo: 2, unit: null })])).toEqual([
      { code: 'discount_out_of_range', lineNo: 1 },
      { code: 'no_price', lineNo: 1 },
      { code: 'missing_unit', lineNo: 2 },
    ]);
  });

  it('does not judge whether a discount is allowed: a large valid discount passes (the ERP decides in erp mode)', () => {
    expect(orderErpIssues([line({ discountPercent: '60' })])).toEqual([]);
  });
});
