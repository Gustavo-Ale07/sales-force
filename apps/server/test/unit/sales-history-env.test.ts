import { describe, expect, it } from 'vitest';
import { EnvValidationError } from '../../src/config/env.js';
import { loadWorkerConfig } from '../../src/config/worker-env.js';

const WORKER = { DATABASE_URL: 'postgres://user:not-a-real-password@127.0.0.1:5432/db', NODE_ENV: 'development' } as const;

function problemsOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof EnvValidationError) return error.problems.join('\n');
    throw error;
  }
  throw new Error('expected an EnvValidationError');
}

describe('worker sales-history configuration (CFG-3)', () => {
  it('is off by default: no TOP is assumed, the mirror has no configuration', () => {
    const config = loadWorkerConfig({ ...WORKER });
    expect(config.salesHistory).toBeNull();
    expect(config.env.SYNC_CRON_SALES_HISTORY).toBe('15 3 * * *');
  });

  it('reads the TOP sets from the environment and applies the documented defaults for the rest', () => {
    const { salesHistory } = loadWorkerConfig({ ...WORKER, SALES_HISTORY_SALE_TOPS: '7102, 7101', SALES_HISTORY_RETURN_TOPS: '7201' });
    expect(salesHistory).toEqual({
      tops: { saleTopCodes: [7101, 7102], returnTopCodes: [7201] },
      statusCodes: ['L'],
      dateField: 'DTNEG',
      windowMonths: 12,
    });
  });

  it('accepts overrides for the status set, the date field and the window', () => {
    const { salesHistory } = loadWorkerConfig({
      ...WORKER,
      SALES_HISTORY_SALE_TOPS: '7101',
      SALES_HISTORY_STATUS_CODES: 'L, P',
      SALES_HISTORY_DATE_FIELD: 'DTFATUR',
      SALES_HISTORY_WINDOW_MONTHS: '6',
    });
    expect(salesHistory).toMatchObject({ statusCodes: ['L', 'P'], dateField: 'DTFATUR', windowMonths: 6 });
  });

  it('refuses a TOP that is both a sale and a return, return TOPs without a sale TOP, and malformed values', () => {
    expect(problemsOf(() => loadWorkerConfig({ ...WORKER, SALES_HISTORY_SALE_TOPS: '7101', SALES_HISTORY_RETURN_TOPS: '7101' }))).toMatch(
      /both a sale and a return/,
    );
    expect(problemsOf(() => loadWorkerConfig({ ...WORKER, SALES_HISTORY_RETURN_TOPS: '7201' }))).toMatch(/SALES_HISTORY_SALE_TOPS is empty/);
    expect(problemsOf(() => loadWorkerConfig({ ...WORKER, SALES_HISTORY_SALE_TOPS: 'abc' }))).toMatch(/SALES_HISTORY_SALE_TOPS/);
    expect(problemsOf(() => loadWorkerConfig({ ...WORKER, SALES_HISTORY_STATUS_CODES: 'liberada' }))).toMatch(/SALES_HISTORY_STATUS_CODES/);
    expect(problemsOf(() => loadWorkerConfig({ ...WORKER, SALES_HISTORY_DATE_FIELD: 'DTALTER' }))).toMatch(/SALES_HISTORY_DATE_FIELD/);
    expect(problemsOf(() => loadWorkerConfig({ ...WORKER, SALES_HISTORY_WINDOW_MONTHS: '0' }))).toMatch(/SALES_HISTORY_WINDOW_MONTHS/);
  });
});
