import { describe, expect, it } from 'vitest';
import { summarizeOpenTitles, type OpenTitle } from '../src/index.js';

const title = (over: Partial<OpenTitle>): OpenTitle => ({
  nufin: 1,
  customerCode: 10,
  companyCode: 1,
  documentNumber: 100,
  dueDate: '2026-11-10',
  amount: '100.00',
  paidAmount: '0',
  ...over,
});

describe('summarizeOpenTitles', () => {
  it('is empty with zero amounts and no oldest due date', () => {
    expect(summarizeOpenTitles([], '2026-11-03')).toEqual({
      openCount: 0,
      openAmount: '0.00',
      overdueCount: 0,
      overdueAmount: '0.00',
      oldestOverdueDueDate: null,
    });
  });

  it('counts the balance (amount - paid) and treats a title due today as not overdue', () => {
    const summary = summarizeOpenTitles(
      [
        title({ nufin: 1, dueDate: '2026-11-03', amount: '100.00', paidAmount: '0' }),
        title({ nufin: 2, dueDate: '2026-11-02', amount: '50.50', paidAmount: '10.25' }),
        title({ nufin: 3, dueDate: '2026-10-20', amount: '20.00', paidAmount: '0' }),
        title({ nufin: 4, dueDate: '2026-12-01', amount: '5.00', paidAmount: '0' }),
      ],
      '2026-11-03',
    );
    expect(summary.openCount).toBe(4);
    expect(summary.openAmount).toBe('165.25');
    expect(summary.overdueCount).toBe(2);
    expect(summary.overdueAmount).toBe('60.25');
    expect(summary.oldestOverdueDueDate).toBe('2026-10-20');
  });

  it('never goes negative when the paid amount exceeds the amount', () => {
    const summary = summarizeOpenTitles([title({ amount: '10.00', paidAmount: '12.00' })], '2026-11-03');
    expect(summary.openAmount).toBe('0.00');
  });
});
