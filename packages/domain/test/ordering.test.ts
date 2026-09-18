import { describe, expect, it } from 'vitest';
import {
  buildOrderItem,
  computeOrderTotals,
  validateDraftInvariants,
  type InstallationConfiguration,
  type OrderItem,
  type ResolvedPrice,
  type SalesOrderDraft,
} from '../src/index.js';
import { makeConfig, makeProduct } from './fixtures.js';

const priced = (unitPrice: string): ResolvedPrice => ({ state: 'priced', unitPrice, tableCode: 88, versionId: 4 });
const zero: ResolvedPrice = { state: 'zero', unitPrice: '0', tableCode: 88, versionId: 4 };
const none: ResolvedPrice = { state: 'none', reason: 'no_price_row', tableCode: 88, versionId: 4 };

const product = makeProduct({ code: 3001, description: 'Produto A', unit: 'CX' });

function item(lineNo: number, quantity: string, price: ResolvedPrice): OrderItem {
  const result = buildOrderItem({ lineNo, product, quantity, price });
  if (!result.ok) throw new Error(`fixture: ${result.error}`);
  return result.value;
}

function draft(items: OrderItem[], patch: Partial<SalesOrderDraft> = {}): SalesOrderDraft {
  return {
    customerCode: 5001,
    sellerCode: 900,
    status: 'draft',
    negotiationTypeCode: 31,
    notes: null,
    items,
    estimatedTotal: computeOrderTotals(items).estimatedTotal,
    ...patch,
  };
}

const allowUnpriced = (c: InstallationConfiguration): InstallationConfiguration => ({
  ...c,
  sales: { ...c.sales, orderBehavior: { allowDraftWithoutPrice: true } },
  products: { ...c.products, productWithoutPrice: { visible: true, orderable: true } },
});

describe('buildOrderItem', () => {
  it('prices a line from the resolved price with half-up rounding', () => {
    expect(item(1, '3', priced('0.335'))).toEqual({
      lineNo: 1,
      productCode: 3001,
      productDescription: 'Produto A',
      unit: 'CX',
      quantity: '3',
      unitListPrice: '0.335',
      priceState: 'priced',
      priceTableCode: 88,
      priceVersionId: 4,
      estimatedLineTotal: '1.01',
    });
  });

  it('zero price: zero estimate, state preserved', () => {
    expect(item(1, '2', zero)).toMatchObject({
      priceState: 'zero',
      unitListPrice: '0',
      estimatedLineTotal: '0.00',
    });
  });

  it('missing price: no unit price and no total (never 0)', () => {
    expect(item(1, '2', none)).toMatchObject({
      priceState: 'none',
      unitListPrice: null,
      estimatedLineTotal: null,
    });
  });

  it.each([
    ['0', 'not_positive'],
    ['-2', 'negative'],
    ['1.00001', 'too_many_decimals'],
    ['x', 'not_a_decimal'],
  ])('rejects quantity %j', (quantity, error) => {
    expect(buildOrderItem({ lineNo: 1, product, quantity, price: priced('1') })).toEqual({ ok: false, error });
  });
});

describe('computeOrderTotals', () => {
  it('sums line estimates exactly', () => {
    const totals = computeOrderTotals([item(1, '3', priced('0.335')), item(2, '1.5', priced('19.99'))]);
    expect(totals).toEqual({ estimatedTotal: '31.00', lineCount: 2, unpricedLineCount: 0, isPartial: false });
  });

  it('lines without price do not count as zero and mark the total partial', () => {
    const totals = computeOrderTotals([item(1, '2', priced('10')), item(2, '5', none), item(3, '1', zero)]);
    expect(totals).toEqual({ estimatedTotal: '20.00', lineCount: 3, unpricedLineCount: 1, isPartial: true });
  });

  it('empty order', () => {
    expect(computeOrderTotals([])).toEqual({
      estimatedTotal: '0.00',
      lineCount: 0,
      unpricedLineCount: 0,
      isPartial: false,
    });
  });
});

describe('validateDraftInvariants', () => {
  const config = makeConfig();
  const codes = (d: SalesOrderDraft, cfg = config, options = {}) =>
    validateDraftInvariants(d, cfg, options).map((i) => `${i.code}@${i.path}`);

  it('accepts a coherent draft', () => {
    expect(codes(draft([item(1, '2', priced('10.5')), item(2, '1', priced('3'))]))).toEqual([]);
  });

  it('accepts an empty draft (nothing to send yet)', () => {
    expect(codes(draft([]))).toEqual([]);
  });

  it('rejects when the installation is not enabled', () => {
    const disabled = makeConfig((c) => ({ ...c, general: { ...c.general, enabled: false } }));
    expect(codes(draft([item(1, '1', priced('1'))]), disabled)).toEqual(['installation_not_enabled@config.general.enabled']);
  });

  it.each(['cancelled', 'queued', 'sent', 'rejected', 'unknown'] as const)('status %s is not editable', (status) => {
    expect(codes(draft([], { status }))).toEqual(['status_not_editable@status']);
  });

  it('checks the negotiation type against configuration', () => {
    expect(codes(draft([], { negotiationTypeCode: 32 }))).toEqual([]);
    expect(codes(draft([], { negotiationTypeCode: 99 }))).toEqual(['negotiation_type_not_configured@negotiationTypeCode']);
    expect(codes(draft([], { negotiationTypeCode: null }))).toEqual([]);
  });

  it('flags invalid and duplicate line numbers', () => {
    const a = item(1, '1', priced('1'));
    expect(codes(draft([a, { ...a, lineNo: 1 }]))).toEqual(['duplicate_line_number@items[1].lineNo']);
    expect(codes(draft([{ ...a, lineNo: 0 }]))).toEqual(['invalid_line_number@items[0].lineNo']);
    expect(codes(draft([{ ...a, lineNo: 1.5 }]))).toEqual(['invalid_line_number@items[0].lineNo']);
  });

  it('flags an invalid quantity', () => {
    const a = item(1, '1', priced('1'));
    expect(codes(draft([{ ...a, quantity: '0' }]))).toContain('invalid_quantity@items[0].quantity');
    expect(codes(draft([{ ...a, quantity: '1.00001' }]))).toContain('invalid_quantity@items[0].quantity');
  });

  it('flags a stale or wrong line total', () => {
    const a = item(1, '2', priced('10'));
    const wrong = { ...a, estimatedLineTotal: '19.99' };
    expect(codes({ ...draft([wrong]), estimatedTotal: '19.99' })).toEqual(['line_total_mismatch@items[0].estimatedLineTotal']);
  });

  it('flags a wrong order total', () => {
    const d = draft([item(1, '2', priced('10'))], { estimatedTotal: '21.00' });
    expect(codes(d)).toEqual(['order_total_mismatch@estimatedTotal']);
  });

  it('flags a malformed order total instead of throwing', () => {
    expect(codes(draft([], { estimatedTotal: 'abc' }))).toEqual(['order_total_mismatch@estimatedTotal']);
  });

  it('flags an order total outside numeric(14,2)', () => {
    const big = item(1, '1', priced('1000000000000'));
    expect(codes(draft([big]))).toContain('order_total_out_of_range@estimatedTotal');
  });

  describe('price state consistency', () => {
    const p = item(1, '2', priced('10'));
    it('none must carry no price or total', () => {
      expect(codes(draft([{ ...item(1, '1', none), unitListPrice: '0' }], { estimatedTotal: '0.00' }), allowUnpriced(config))).toContain(
        'price_state_inconsistent@items[0].priceState',
      );
    });
    it('priced with a zero unit price is inconsistent', () => {
      const bad = { ...p, unitListPrice: '0', estimatedLineTotal: '0.00' };
      expect(codes(draft([bad]))).toContain('price_state_inconsistent@items[0].priceState');
    });
    it('zero with a positive unit price is inconsistent', () => {
      const bad = { ...p, priceState: 'zero' as const };
      expect(codes(draft([bad]))).toContain('price_state_inconsistent@items[0].priceState');
    });
    it('priced without a price is inconsistent', () => {
      const bad = { ...p, unitListPrice: null };
      expect(codes(draft([bad]))).toContain('price_state_inconsistent@items[0].unitListPrice');
    });
    it('priced without price table/version reference', () => {
      expect(codes(draft([{ ...p, priceVersionId: null }]))).toContain('price_reference_missing@items[0].priceVersionId');
    });
  });

  describe('orderability of lines without a usable price', () => {
    const unpriced = [item(1, '1', none), item(2, '1', zero)];
    it('rejected by default', () => {
      expect(codes(draft(unpriced))).toEqual([
        'line_not_orderable@items[0].priceState',
        'line_not_orderable@items[1].priceState',
      ]);
    });
    it('accepted when configuration allows it', () => {
      expect(codes(draft(unpriced), allowUnpriced(config))).toEqual([]);
    });
    it('rejected in the unconfigured default even for an otherwise valid draft', () => {
      const unconfigured = makeConfig((c) => ({ ...c, sales: { ...c.sales, orderBehavior: { allowDraftWithoutPrice: false } } }));
      expect(codes(draft(unpriced), unconfigured)).toHaveLength(2);
    });
  });

  describe('product sellability (when a product lookup is supplied)', () => {
    const d = draft([item(1, '1', priced('1'))]);
    it('accepts a sellable product', () => {
      expect(codes(d, config, { products: new Map([[3001, makeProduct({ code: 3001 })]]) })).toEqual([]);
    });
    it('flags an unknown product', () => {
      expect(codes(d, config, { products: new Map() })).toEqual(['product_unknown@items[0].productCode']);
    });
    it('flags a product not sellable per configuration', () => {
      const other = makeProduct({ code: 3001, usageCode: 'Z9' });
      expect(codes(d, config, { products: new Map([[3001, other]]) })).toEqual(['product_not_sellable@items[0].productCode']);
    });
  });
});
