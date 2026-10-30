import { describe, expect, it } from 'vitest';
import {
  eligibleOrderTopCodesOf,
  isQuotationTopCode,
  resolveOrderTopCode,
  sellableNegotiationTypes,
  validateConfigurationConsistency,
  validateDraftInvariants,
  type InstallationConfiguration,
} from '../src/index.js';
import { makeConfig } from './fixtures.js';

const withSales = (patch: Partial<InstallationConfiguration['sales']>): InstallationConfiguration =>
  makeConfig((c) => ({ ...c, sales: { ...c.sales, ...patch } }));

describe('order TOP (D-A / D-B)', () => {
  const config = withSales({ orderTopCode: 3001, quotationTopCode: 1000, eligibleOrderTopCodes: [3001, 1000] });

  it('uses the configured default TOP when the request names none', () => {
    expect(resolveOrderTopCode(undefined, config.sales)).toEqual({ ok: true, value: 3001 });
    expect(resolveOrderTopCode(null, config.sales)).toEqual({ ok: true, value: 3001 });
  });

  it('accepts an eligible TOP and refuses any other', () => {
    expect(resolveOrderTopCode(1000, config.sales)).toEqual({ ok: true, value: 1000 });
    expect(resolveOrderTopCode(1051, config.sales)).toEqual({ ok: false, code: 'order_top_not_eligible' });
  });

  it('without an explicit list the eligible TOPs are the order and quotation TOPs', () => {
    const sales = withSales({ orderTopCode: 3001, quotationTopCode: 1000 }).sales;
    expect(eligibleOrderTopCodesOf(sales)).toEqual([3001, 1000]);
  });

  it('with no TOP configured at all there is nothing to store', () => {
    const sales = withSales({ orderTopCode: null, quotationTopCode: null }).sales;
    expect(resolveOrderTopCode(undefined, sales)).toEqual({ ok: true, value: null });
    expect(resolveOrderTopCode(3001, sales)).toEqual({ ok: false, code: 'order_top_not_eligible' });
  });

  it('a quotation is an order whose TOP is the quotation TOP', () => {
    expect(isQuotationTopCode(1000, config.sales)).toBe(true);
    expect(isQuotationTopCode(3001, config.sales)).toBe(false);
    expect(isQuotationTopCode(null, config.sales)).toBe(false);
  });
});

describe('sellable negotiation types', () => {
  it('lists only sellable types; absent flag means sellable', () => {
    const sales = withSales({
      negotiationTypes: [
        { code: 1, label: 'A' },
        { code: 23, label: 'DEVOLUCAO', sellable: false },
        { code: 3, label: 'C', sellable: true },
      ],
    }).sales;
    expect(sellableNegotiationTypes(sales).map((t) => t.code)).toEqual([1, 3]);
  });

  it('a draft with a non-sellable negotiation type is refused', () => {
    const config = withSales({
      defaultNegotiationTypeCode: null,
      negotiationTypes: [{ code: 23, label: 'DEVOLUCAO', sellable: false }, { code: 2, label: 'OK' }],
    });
    const base = { customerCode: 1, sellerCode: 1, status: 'draft' as const, notes: null, items: [], estimatedTotal: '0.00' };
    expect(validateDraftInvariants({ ...base, negotiationTypeCode: 23 }, config).map((i) => i.code)).toContain('negotiation_type_not_configured');
    expect(validateDraftInvariants({ ...base, negotiationTypeCode: 2 }, config).map((i) => i.code)).not.toContain('negotiation_type_not_configured');
  });
});

describe('configuration consistency for negotiation types', () => {
  it('a non-sellable default negotiation type is reported', () => {
    const config = withSales({ defaultNegotiationTypeCode: 23, negotiationTypes: [{ code: 23, label: 'DEVOLUCAO', sellable: false }] });
    expect(validateConfigurationConsistency(config).map((i) => i.code)).toContain('default_negotiation_type_not_sellable');
  });
});
