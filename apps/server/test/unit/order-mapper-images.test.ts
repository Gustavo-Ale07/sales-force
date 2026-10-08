import { describe, expect, it } from 'vitest';
import { toOrderDetail } from '../../src/orders/order.mapper.js';

const img = (code: number) => ({
  version: `v${code}`,
  thumbnailUrl: `/api/v1/products/${code}/image?variant=thumb`,
  url: `/api/v1/products/${code}/image?variant=full`,
});

function item(lineNo: number, productCode: number) {
  return {
    lineNo,
    productCode,
    productDescription: `Produto ${productCode}`,
    unit: 'UN',
    quantity: '1',
    unitListPrice: '10',
    priceState: 'priced',
    priceTableCode: 1,
    priceVersionId: 1,
    discountPercent: '0',
    estimatedLineTotal: '10.00',
  } as never;
}

const order = {
  id: '0190c0de-0000-7000-8000-000000000001',
  draftNumber: 1,
  customerCode: 7,
  sellerCode: 3,
  status: 'draft',
  estimatedTotal: '20.00',
  version: 1,
  createdAt: new Date('2026-10-08T10:00:00Z'),
  updatedAt: new Date('2026-10-08T10:00:00Z'),
} as never;
const customer = { customerName: 'Cliente', customerActive: true, customerBlockedRaw: null, customerSellerCode: 3, customerLive: true } as never;

describe('order detail media', () => {
  it('attaches the shared product media metadata per line, never swapping products, and omits it when absent', () => {
    const detail = toOrderDetail(order, [item(1, 4158), item(2, 9)], customer, new Map([[4158, img(4158)]]));
    expect(detail.items[0]?.image).toEqual(img(4158));
    expect(detail.items[1]).not.toHaveProperty('image');
  });

  it('works without any media (source failure degrades to placeholders)', () => {
    const detail = toOrderDetail(order, [item(1, 4158)], customer);
    expect(detail.items[0]).not.toHaveProperty('image');
  });
});
