import { describe, expect, it } from 'vitest';
import { FakeGateway, FakeOrderBook, buildIncluirNotaBody, usesInformedPrice, type OrderWriteRequest } from '../src/index.js';

/**
 * D-AK: the first real write with a discount (Sandbox note 2499) came back with PERCDESC 0 and VLRDESC 0 because the
 * item carried no price (INFORMARPRECO "False"). A note with a discount now sends INFORMARPRECO "True" and the table
 * price (VLRUNIT) on every line; a note without a discount stays exactly as before.
 */
function request(items: OrderWriteRequest['items']): OrderWriteRequest {
  return {
    originId: '01a1c128-b8a3-75e6-a695-799ff31cc4fe',
    originField: 'AD_FORCEORIGEM',
    customerCode: 77,
    sellerCode: 5,
    companyCode: 1,
    topCode: 1001,
    negotiationTypeCode: 11,
    carrierCode: null,
    freightType: 'FOB',
    expedicao: false,
    stockLocationCode: 209,
    orderDate: '2026-11-09',
    notes: null,
    items,
  };
}

const discounted = { productCode: 4158, quantity: '10', unit: 'PT', discountPercent: '8', listUnitPrice: '28.94' } as const;
const plain = { productCode: 4159, quantity: '10', unit: 'PT', discountPercent: null, listUnitPrice: '38.47' } as const;

type Item = Record<string, unknown>;
const itemsOf = (body: ReturnType<typeof buildIncluirNotaBody>): { informed: unknown; items: Item[] } => {
  const itens = (body as { nota: { itens: { INFORMARPRECO: unknown; item: Item[] } } }).nota.itens;
  return { informed: itens.INFORMARPRECO, items: itens.item };
};

describe('payload with a discount (D-AK)', () => {
  it('sends INFORMARPRECO True with VLRUNIT and PERCDESC on EVERY line (PERCDESC "0" when the line has no discount)', () => {
    const { informed, items } = itemsOf(buildIncluirNotaBody(request([discounted, plain])));
    expect(informed).toBe('True');
    expect(items[0]).toMatchObject({ CODPROD: { $: '4158' }, QTDNEG: { $: '10' }, VLRUNIT: { $: '28.94' }, PERCDESC: { $: '8' } });
    expect(items[1]).toMatchObject({ CODPROD: { $: '4159' }, VLRUNIT: { $: '38.47' }, PERCDESC: { $: '0' } });
    expect(JSON.stringify(items)).not.toContain('VLRDESC');
  });

  it('the Sandbox order of 13 lines (4 without discount, 4 at 5%, 5 at 8%): every line has VLRUNIT and PERCDESC', () => {
    const line = (productCode: number, discountPercent: string | null) => ({ productCode, quantity: '2', unit: 'CX', discountPercent, listUnitPrice: '70.97' }) as const;
    const percents = [null, null, null, null, '5', '5', '5', '5', '8', '8', '8', '8', '8'] as const;
    const { informed, items } = itemsOf(buildIncluirNotaBody(request(percents.map((percent, index) => line(100 + index, percent)))));
    expect(informed).toBe('True');
    expect(items).toHaveLength(13);
    for (const [index, item] of items.entries()) {
      expect(item, `line ${index + 1}`).toHaveProperty('VLRUNIT', { $: '70.97' });
      expect(item, `line ${index + 1}`).toHaveProperty('PERCDESC', { $: percents[index] ?? '0' });
    }
    expect(items.filter((item) => (item['PERCDESC'] as { $: string }).$ === '0')).toHaveLength(4);
    expect(items.filter((item) => (item['PERCDESC'] as { $: string }).$ === '5')).toHaveLength(4);
    expect(items.filter((item) => (item['PERCDESC'] as { $: string }).$ === '8')).toHaveLength(5);
  });

  it('a note with no discount stays as before: INFORMARPRECO False and no VLRUNIT', () => {
    const body = buildIncluirNotaBody(request([{ ...plain }, { ...plain, productCode: 1 }]));
    const { informed, items } = itemsOf(body);
    expect(informed).toBe('False');
    for (const item of items) {
      expect(item).not.toHaveProperty('VLRUNIT');
      expect(item).not.toHaveProperty('PERCDESC');
    }
    expect(usesInformedPrice(request([plain]))).toBe(false);
  });

  it('a zero percent is not a discount', () => {
    expect(usesInformedPrice(request([{ ...plain, discountPercent: '0' }]))).toBe(false);
  });
});

describe('fake ERP and the discount (D-AK)', () => {
  const stored = async (book: FakeOrderBook, items: OrderWriteRequest['items']) => {
    const gateway = new FakeGateway({ orders: book });
    const { erpOrderNumber } = await gateway.includeOrder(request(items));
    return gateway.readWrittenOrder(erpOrderNumber);
  };

  it('accepts the discount when the note carries the price (True) and derives VLRDESC itself', async () => {
    const written = await stored(new FakeOrderBook({ priceOf: (code) => (code === 4158 ? '28.94' : '38.47') }), [discounted, plain]);
    expect(written?.items[0]).toMatchObject({ unitPrice: '28.94', discountPercent: '8', discountAmount: '23.20' });
    expect(written?.items[1]).toMatchObject({ unitPrice: '38.47', discountPercent: null, discountAmount: '0' });
  });

  it('drops the discount when it can be ignored (the regression seen in the Sandbox)', async () => {
    const written = await stored(new FakeOrderBook({ ignoreDiscount: true }), [discounted]);
    expect(written?.items[0]).toMatchObject({ discountPercent: null, discountAmount: '0' });
  });

  it('can keep the percentage but store VLRDESC 0', async () => {
    const written = await stored(new FakeOrderBook({ zeroDiscountAmount: true }), [discounted]);
    expect(written?.items[0]).toMatchObject({ discountPercent: '8', discountAmount: '0' });
  });
});
