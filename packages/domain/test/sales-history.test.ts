import { describe, expect, it } from 'vitest';
import {
  classifySalesHistoryTop,
  positivatedCustomerCodes,
  rankCustomersByNet,
  summarizeSalesBySellerMonth,
  validateSalesHistoryTops,
  type SalesHistoryMonthlyBucket,
  type SalesHistoryTops,
} from '../src/index.js';

// Synthetic TOP codes: the domain holds no customer-specific value, configuration supplies them.
const TOPS: SalesHistoryTops = { saleTopCodes: [7101, 7102], returnTopCodes: [7201] };

// The kind is decided once, when the worker writes the snapshot (classifySalesHistoryTop); readers only use it.
const bucket = (over: Partial<Omit<SalesHistoryMonthlyBucket, 'topKind'>>): SalesHistoryMonthlyBucket => {
  const topCode = over.topCode ?? 7101;
  return {
    customerCode: 1,
    sellerCode: 10,
    month: '2026-09',
    noteCount: 1,
    totalAmount: '100.00',
    ...over,
    topCode,
    topKind: classifySalesHistoryTop(topCode, TOPS),
  };
};

describe('validateSalesHistoryTops', () => {
  it('accepts disjoint, non-empty sale TOPs and any return TOPs (including none)', () => {
    expect(validateSalesHistoryTops(TOPS)).toEqual({ ok: true, value: { saleTopCodes: [7101, 7102], returnTopCodes: [7201] } });
    expect(validateSalesHistoryTops({ saleTopCodes: [7101], returnTopCodes: [] }).ok).toBe(true);
  });
  it('refuses no sale TOP, a TOP that is both sale and return, and non-positive-integer codes', () => {
    expect(validateSalesHistoryTops({ saleTopCodes: [], returnTopCodes: [7201] })).toEqual({ ok: false, reason: 'no_sale_top' });
    expect(validateSalesHistoryTops({ saleTopCodes: [7101], returnTopCodes: [7101] })).toEqual({ ok: false, reason: 'top_is_sale_and_return' });
    expect(validateSalesHistoryTops({ saleTopCodes: [0], returnTopCodes: [] })).toEqual({ ok: false, reason: 'invalid_top_code' });
    expect(validateSalesHistoryTops({ saleTopCodes: [7101.5], returnTopCodes: [] })).toEqual({ ok: false, reason: 'invalid_top_code' });
  });
  it('sorts and de-duplicates', () => {
    expect(validateSalesHistoryTops({ saleTopCodes: [7102, 7101, 7101], returnTopCodes: [7201, 7201] })).toEqual({
      ok: true,
      value: { saleTopCodes: [7101, 7102], returnTopCodes: [7201] },
    });
  });
});

describe('classifySalesHistoryTop', () => {
  it('classifies sale, return and everything else', () => {
    expect(classifySalesHistoryTop(7101, TOPS)).toBe('sale');
    expect(classifySalesHistoryTop(7201, TOPS)).toBe('return');
    expect(classifySalesHistoryTop(7001, TOPS)).toBe('other');
  });
});

describe('summarizeSalesBySellerMonth', () => {
  it('is empty for no rows', () => {
    expect(summarizeSalesBySellerMonth([])).toEqual([]);
  });

  it('net = sales TOP total minus return TOP total, per seller and month, ordered by seller then month', () => {
    const rows = [
      bucket({ sellerCode: 20, month: '2026-09', totalAmount: '50.00' }),
      bucket({ sellerCode: 10, month: '2026-10', totalAmount: '300.10', noteCount: 2 }),
      bucket({ sellerCode: 10, month: '2026-10', topCode: 7102, totalAmount: '0.20' }),
      bucket({ sellerCode: 10, month: '2026-10', topCode: 7201, totalAmount: '120', noteCount: 1 }),
      bucket({ sellerCode: 10, month: '2026-09', totalAmount: '1000.00' }),
    ];
    expect(summarizeSalesBySellerMonth(rows)).toEqual([
      { sellerCode: 10, month: '2026-09', sales: '1000.00', returns: '0.00', net: '1000.00', saleNoteCount: 1, returnNoteCount: 0, positivatedCustomers: 1 },
      { sellerCode: 10, month: '2026-10', sales: '300.30', returns: '120.00', net: '180.30', saleNoteCount: 3, returnNoteCount: 1, positivatedCustomers: 1 },
      { sellerCode: 20, month: '2026-09', sales: '50.00', returns: '0.00', net: '50.00', saleNoteCount: 1, returnNoteCount: 0, positivatedCustomers: 1 },
    ]);
  });

  it('net can be negative when returns exceed sales (signed decimal string, no JS number math)', () => {
    const rows = [bucket({ totalAmount: '10.10' }), bucket({ topCode: 7201, totalAmount: '10.30' })];
    expect(summarizeSalesBySellerMonth(rows)[0]).toMatchObject({ sales: '10.10', returns: '10.30', net: '-0.20' });
  });

  it('ignores TOPs that are neither sale nor return', () => {
    expect(summarizeSalesBySellerMonth([bucket({ topCode: 7001, totalAmount: '999.00' })])).toEqual([]);
  });

  it('counts a customer once per seller-month even with several sale TOPs, and not when it only returned', () => {
    const rows = [
      bucket({ customerCode: 1 }),
      bucket({ customerCode: 1, topCode: 7102 }),
      bucket({ customerCode: 2, topCode: 7201 }),
      bucket({ customerCode: 3, noteCount: 0, totalAmount: '0.00' }),
    ];
    expect(summarizeSalesBySellerMonth(rows)[0]?.positivatedCustomers).toBe(1);
  });

  it('keeps amounts exact over many cents (0.1 + 0.2 style sums)', () => {
    const rows = Array.from({ length: 10 }, (_, i) => bucket({ customerCode: i + 1, totalAmount: '0.10' }));
    expect(summarizeSalesBySellerMonth(rows)[0]).toMatchObject({ sales: '1.00', positivatedCustomers: 10 });
  });
});

describe('positivatedCustomerCodes', () => {
  it('is the distinct set of customers with at least one sale-TOP note in the rows', () => {
    const rows = [
      bucket({ customerCode: 5 }),
      bucket({ customerCode: 5, month: '2026-10' }),
      bucket({ customerCode: 6, topCode: 7201 }),
      bucket({ customerCode: 7, noteCount: 0, totalAmount: '0' }),
      bucket({ customerCode: 8, topCode: 7001 }),
    ];
    expect([...positivatedCustomerCodes(rows)]).toEqual([5]);
  });
});

describe('rankCustomersByNet', () => {
  it('ranks by net descending, ties by customer code, with sales and returns shown', () => {
    const rows = [
      bucket({ customerCode: 3, totalAmount: '100.00' }),
      bucket({ customerCode: 2, totalAmount: '100.00' }),
      bucket({ customerCode: 1, totalAmount: '500.00' }),
      bucket({ customerCode: 1, topCode: 7201, totalAmount: '450.00' }),
      bucket({ customerCode: 4, topCode: 7201, totalAmount: '10.00' }),
    ];
    expect(rankCustomersByNet(rows).map((r) => [r.customerCode, r.net])).toEqual([
      [2, '100.00'],
      [3, '100.00'],
      [1, '50.00'],
      [4, '-10.00'],
    ]);
    expect(rankCustomersByNet(rows)[2]).toEqual({ customerCode: 1, sales: '500.00', returns: '450.00', net: '50.00', saleNoteCount: 1 });
  });

  it('honours a limit and sums across months and sellers', () => {
    const rows = [
      bucket({ customerCode: 1, month: '2026-09', totalAmount: '10.00' }),
      bucket({ customerCode: 1, month: '2026-10', sellerCode: 99, totalAmount: '15.00' }),
      bucket({ customerCode: 2, totalAmount: '20.00' }),
    ];
    const ranked = rankCustomersByNet(rows, 1);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({ customerCode: 1, net: '25.00', saleNoteCount: 2 });
  });
});
