import { subtractTotals, sumTotals, compareDecimalStrings, type DecimalString } from './money.js';

/**
 * An open receivable title mirrored from the ERP (read-only; D-I). Dates are business dates `YYYY-MM-DD`.
 * `amount` is the title value, `paidAmount` what was already settled (the balance is the difference).
 */
export interface OpenTitle {
  readonly nufin: number;
  readonly customerCode: number;
  readonly companyCode: number | null;
  /** Sales document number (ERP document id), when the title comes from a document. */
  readonly documentNumber: number | null;
  readonly dueDate: string;
  readonly amount: DecimalString;
  readonly paidAmount: DecimalString;
}

export interface FinancialSummary {
  readonly openCount: number;
  /** Sum of balances (amount - paid), 2 decimals. */
  readonly openAmount: DecimalString;
  readonly overdueCount: number;
  readonly overdueAmount: DecimalString;
  /** Earliest due date among the overdue titles; `null` when none. */
  readonly oldestOverdueDueDate: string | null;
}

/** Balance of a title, never negative. */
export function titleBalance(title: Pick<OpenTitle, 'amount' | 'paidAmount'>): DecimalString {
  return compareDecimalStrings(title.amount, title.paidAmount) <= 0
    ? '0.00'
    : subtractTotals(sumTotals([title.amount]), sumTotals([title.paidAmount]));
}

/**
 * Open and overdue totals of one customer's titles. A title is overdue when its due date is before `today`
 * (the ERP rule `DTVENC + 1 < SYSDATE`, at date granularity); `today` is the business date in
 * America/Sao_Paulo, injected by the caller.
 */
export function summarizeOpenTitles(titles: readonly OpenTitle[], today: string): FinancialSummary {
  const overdue = titles.filter((t) => t.dueDate < today);
  const oldest = overdue.reduce<string | null>((acc, t) => (acc === null || t.dueDate < acc ? t.dueDate : acc), null);
  return {
    openCount: titles.length,
    openAmount: sumTotals(titles.map(titleBalance)),
    overdueCount: overdue.length,
    overdueAmount: sumTotals(overdue.map(titleBalance)),
    oldestOverdueDueDate: oldest,
  };
}
