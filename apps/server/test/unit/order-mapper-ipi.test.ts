import { describe, expect, it } from 'vitest';
import { toOrderDetail } from '../../src/orders/order.mapper.js';

function item(lineNo: number, productCode: number, total: string) {
  return {
    lineNo,
    productCode,
    productDescription: `Produto ${productCode}`,
    unit: 'UN',
    quantity: '1',
    unitListPrice: total,
    priceState: 'priced',
    priceTableCode: 1,
    priceVersionId: 1,
    discountPercent: '0',
    estimatedLineTotal: total,
  } as never;
}

const order = {
  id: '0190c0de-0000-7000-8000-000000000002',
  draftNumber: 2,
  customerCode: 7,
  sellerCode: 3,
  status: 'draft',
  estimatedTotal: '0',
  version: 1,
  createdAt: new Date('2026-11-03T10:00:00Z'),
  updatedAt: new Date('2026-11-03T10:00:00Z'),
} as never;
const customer = { customerName: 'Cliente', customerActive: true, customerBlockedRaw: null, customerSellerCode: 3, customerLive: true } as never;

const rates = new Map([
  [5, { code: 5, percentual: '3.25', byTariff: false, description: 'IPI DE 3,25%' }],
  [6, { code: 6, percentual: '9.75', byTariff: false, description: 'IPI DE 9,75%' }],
  [8, { code: 8, percentual: '0', byTariff: true, description: 'PAUTA' }],
]);
const codes = new Map([
  [4158, 5],
  [13, 6],
  [77, 8],
  [88, 99], // code without a mirrored rate
]);

describe('order detail estimated IPI (D-D)', () => {
  it('estimates per line from the net total and sums the order', () => {
    const detail = toOrderDetail(order, [item(1, 4158, '100.00'), item(2, 13, '16.43')], customer, new Map(), null, {}, { codes, rates });
    expect(detail.items[0]?.ipi).toEqual({ status: 'estimated', amount: '3.25', percentual: '3.25' });
    expect(detail.items[1]?.ipi).toEqual({ status: 'estimated', amount: '1.60', percentual: '9.75' });
    expect(detail.ipi).toMatchObject({ ipiEstimated: '4.85', grandTotalEstimated: '121.28', isPartial: false });
  });

  it('never shows a silent zero: no code, code without rate and tariff are flagged and make the total partial', () => {
    const detail = toOrderDetail(order, [item(1, 9, '10.00'), item(2, 88, '10.00'), item(3, 77, '10.00')], customer, new Map(), null, {}, { codes, rates });
    expect(detail.items.map((i) => i.ipi?.status)).toEqual(['unavailable', 'unavailable', 'tariff']);
    expect(detail.ipi).toMatchObject({ ipiEstimated: '0.00', unavailableLineCount: 2, tariffLineCount: 1, isPartial: true });
  });
});
