import { defaultUnconfiguredConfiguration, type InstallationConfiguration } from '@salesforce/domain';
import type { WrittenOrder } from '@salesforce/sankhya';
import { describe, expect, it } from 'vitest';
import {
  buildOrderRequest,
  businessDate,
  dryRunRecord,
  resolveHeader,
  verifyWrittenOrder,
  type DeliveryItem,
  type DeliveryOrder,
} from '../../src/integration/order-request.js';

const ORDER: DeliveryOrder = {
  id: '018f0000-0000-7000-8000-000000000001',
  customerCode: 77,
  sellerCode: 9,
  negotiationTypeCode: 11,
  topCode: null,
  carrierCode: null,
  notes: 'Entregar pela manhã, falar com Maria 11 99999-0000',
  createdAt: new Date('2026-10-30T02:30:00Z'),
};
const ITEM: DeliveryItem = { productCode: 4158, unit: 'PT', quantity: '0.2000', unitListPrice: '10.500000', discountPercent: '8.00', priceState: 'priced' };

function config(over: Partial<InstallationConfiguration['sales']> = {}, company: number | null = 1): InstallationConfiguration {
  const base = defaultUnconfiguredConfiguration();
  return {
    ...base,
    general: { ...base.general, enabledCompanyCodes: [1], defaultCompanyCode: company },
    sales: { ...base.sales, orderTopCode: 1001, eligibleOrderTopCodes: [1000, 1001], orderStockLocationCode: 209, ...over },
  };
}

describe('resolveHeader (D-8: nothing literal)', () => {
  it('takes company, TOP and stock location from the configuration and the date in the business zone', () => {
    const header = resolveHeader(ORDER, config());
    expect(header).toEqual({ ok: true, value: { v: 1, companyCode: 1, topCode: 1001, stockLocationCode: 209, carrierCode: null, orderDate: '2026-10-29' } });
  });

  it('prefers the order TOP and refuses one that is not eligible', () => {
    expect(resolveHeader({ ...ORDER, topCode: 1000 }, config())).toMatchObject({ ok: true, value: { topCode: 1000 } });
    expect(resolveHeader({ ...ORDER, topCode: 1051 }, config())).toMatchObject({ ok: false, code: 'top_not_eligible' });
  });

  it.each([
    [config({}, null), 'missing_company'],
    [config({ orderTopCode: null }), 'missing_top'],
    [config({ orderStockLocationCode: null }), 'missing_stock_location'],
  ] as const)('refuses an incomplete configuration (%#)', (cfg, code) => {
    expect(resolveHeader(ORDER, cfg)).toMatchObject({ ok: false, code });
  });

  it('businessDate uses America/Sao_Paulo', () => {
    expect(businessDate(new Date('2026-10-30T02:59:00Z'))).toBe('2026-10-29');
    expect(businessDate(new Date('2026-10-30T03:00:00Z'))).toBe('2026-10-30');
  });
});

describe('buildOrderRequest', () => {
  const header = { v: 1 as const, companyCode: 1, topCode: 1001, stockLocationCode: 209, carrierCode: null, orderDate: '2026-10-29' };

  it('maps every field from the order, canonical decimals, zero discount as none', () => {
    const built = buildOrderRequest(ORDER, [ITEM, { ...ITEM, productCode: 1440, quantity: '2.0000', discountPercent: '0.00' }], header, 'AD_TESTE');
    expect(built).toMatchObject({
      ok: true,
      value: {
        originId: ORDER.id,
        originField: 'AD_TESTE',
        customerCode: 77,
        sellerCode: 9,
        negotiationTypeCode: 11,
        items: [
          { productCode: 4158, quantity: '0.2', unit: 'PT', discountPercent: '8' },
          { productCode: 1440, quantity: '2', unit: 'PT', discountPercent: null },
        ],
      },
    });
  });

  it.each([
    [{ ...ORDER, negotiationTypeCode: null }, [ITEM], 'missing_negotiation_type'],
    [ORDER, [], 'no_items'],
    [ORDER, [{ ...ITEM, unit: null }], 'missing_unit'],
    [ORDER, [{ ...ITEM, priceState: 'none', unitListPrice: null }], 'no_price'],
    [ORDER, [{ ...ITEM, priceState: 'zero' }], 'no_price'],
  ] as const)('refuses an order that cannot be sent (%#)', (order, items, code) => {
    expect(buildOrderRequest(order, items, header, 'AD_TESTE')).toMatchObject({ ok: false, code });
  });
});

describe('dryRunRecord (D-6)', () => {
  const header = { v: 1 as const, companyCode: 1, topCode: 1001, stockLocationCode: 209, carrierCode: null, orderDate: '2026-10-29' };
  const built = buildOrderRequest(ORDER, [ITEM], header, 'AD_TESTE');
  if (!built.ok) throw new Error('fixture');

  it('keeps codes and values but replaces the note by its hash', () => {
    const record = dryRunRecord(built.value);
    const text = JSON.stringify(record.payload);
    expect(text).not.toContain('Maria');
    expect(text).not.toContain('99999');
    expect(text).toMatch(/"OBSERVACAO":\{"\$":"sha256:[0-9a-f]{64}"\}/);
    expect(text).toContain(ORDER.id);
    expect(text).toContain('"CODTIPOPER":{"$":"1001"}');
    expect(record.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(dryRunRecord(built.value)).toEqual(dryRunRecord(built.value));
  });
});

describe('verifyWrittenOrder (D-7)', () => {
  const written = (over: Partial<WrittenOrder['items'][number]> = {}): WrittenOrder => ({
    erpOrderNumber: 5000,
    confirmed: true,
    items: [{ productCode: 4158, quantity: '0.2', unitPrice: '10.5', discountPercent: '8', ...over }],
  });

  it('accepts equal price and discount regardless of trailing zeros', () => {
    expect(verifyWrittenOrder([ITEM], written())).toEqual({ ok: true });
  });

  it('flags a different unit price, an ignored discount and a missing line', () => {
    expect(verifyWrittenOrder([ITEM], written({ unitPrice: '11' }))).toMatchObject({ ok: false, code: 'price_divergence', productCode: 4158 });
    expect(verifyWrittenOrder([ITEM], written({ discountPercent: null }))).toMatchObject({ ok: false, code: 'discount_divergence' });
    expect(verifyWrittenOrder([ITEM], { ...written(), items: [] })).toMatchObject({ ok: false, code: 'item_mismatch' });
    expect(verifyWrittenOrder([], written())).toMatchObject({ ok: false, code: 'item_mismatch' });
  });

  it('treats a null discount as zero when none was sent', () => {
    expect(verifyWrittenOrder([{ ...ITEM, discountPercent: '0.00' }], written({ discountPercent: null }))).toEqual({ ok: true });
  });
});

describe('carrier (D-C, D-8)', () => {
  it('flows from the order into the frozen header and the write request (CODPARCTRANSP) when set', () => {
    const header = resolveHeader({ ...ORDER, carrierCode: 1234 }, config());
    expect(header).toMatchObject({ ok: true, value: { carrierCode: 1234 } });
    if (!header.ok) return;
    const built = buildOrderRequest({ ...ORDER, carrierCode: 1234 }, [ITEM], header.value, 'AD_TESTE');
    expect(built).toMatchObject({ ok: true, value: { carrierCode: 1234 } });
  });

  it('stays null when the order has no carrier', () => {
    const header = resolveHeader(ORDER, config());
    expect(header).toMatchObject({ ok: true, value: { carrierCode: null } });
  });
});
