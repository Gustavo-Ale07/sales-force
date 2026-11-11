import type { DecimalString } from '@salesforce/domain';
import { SankhyaGatewayError } from './errors.js';
import type { ReadOptions } from './gateway.js';

/**
 * Sales-history mirror (stage D, block 1): read-only aggregates of ERP sales/return notes, in Sales Force shape.
 * Only codes and decimal strings cross the boundary: never names, tax ids, cost, margin or commission.
 *
 * Which TOPs, which note statuses and which date field define "a sale" are installation configuration (CFG-3/CFG-6),
 * passed by the caller in `SalesHistoryReadConfig`; the gateway has no default for them. NEEDS VALIDATION with the
 * ERP owner (spike): the date field (DTNEG x DTFATUR) and the status set.
 */

export type SalesHistoryDateField = 'DTNEG' | 'DTFATUR';
export const SALES_HISTORY_DATE_FIELDS: readonly SalesHistoryDateField[] = ['DTNEG', 'DTFATUR'];
export const DEFAULT_SALES_HISTORY_WINDOW_MONTHS = 12;
const MAX_WINDOW_MONTHS = 120;
const MAX_TOP_CODES = 50;
const MAX_STATUS_CODES = 10;

export interface SalesHistoryReadConfig {
  /** TOPs included (sale TOPs and return TOPs alike); positive integers, 1 to 50 of them. Supplied by configuration. */
  readonly topCodes: readonly number[];
  /** `STATUSNOTA` values included (one uppercase letter each), e.g. the valid, non-cancelled status. Supplied by configuration. */
  readonly statusCodes: readonly string[];
  /** Date column that places a note in a month; default `DTNEG`. */
  readonly dateField?: SalesHistoryDateField;
  /** Calendar months in the window, the month of `asOf` included; default 12. Ignored when `since` is given. */
  readonly windowMonths?: number;
  /** Explicit window start, `YYYY-MM-DD` (inclusive). Wins over `windowMonths`. */
  readonly since?: string;
  /** Reference day, `YYYY-MM-DD`, for `windowMonths`. Default: the gateway clock (real) / a fixed demo day (fake). */
  readonly asOf?: string;
}

export interface SalesHistoryReadOptions extends ReadOptions {
  readonly config: SalesHistoryReadConfig;
}

/** One customer x seller x month x TOP bucket of `SUM(VLRNOTA)`. `sellerCode` 0 = the note has no seller. */
export interface SalesHistoryMonthlyRow {
  readonly customerCode: number;
  readonly sellerCode: number;
  /** `YYYY-MM` of the configured date field. */
  readonly month: string;
  readonly topCode: number;
  readonly noteCount: number;
  readonly totalAmount: DecimalString;
}

/** One customer x product x TOP bucket of item quantity and net value (`VLRTOT - VLRDESC`). */
export interface SalesHistoryCustomerProductRow {
  readonly customerCode: number;
  readonly productCode: number;
  readonly topCode: number;
  readonly noteCount: number;
  readonly quantity: DecimalString;
  readonly netAmount: DecimalString;
  /** `YYYY-MM-DD` of the latest note in the bucket. */
  readonly lastSaleDate: string;
}

export interface ValidatedSalesHistoryConfig {
  readonly topCodes: readonly number[];
  readonly statusCodes: readonly string[];
  readonly dateField: SalesHistoryDateField;
  /** Inclusive window start, `YYYY-MM-DD`. */
  readonly since: string;
}

function invalid(detail: string): SankhyaGatewayError {
  return new SankhyaGatewayError('validation', {
    code: 'invalid_sales_history_config',
    message: `Sales history read refused: ${detail}.`,
  });
}

function validDay(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (y < 1990 || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return { y, m, d };
}

/**
 * Validates every value that will reach SQL text or a filter (integers, enum, strict patterns), and resolves the window start.
 * `nowIso` is the reference when `asOf` is absent. Throws a `validation` error (never retryable).
 */
export function validateSalesHistoryConfig(config: SalesHistoryReadConfig, nowIso: string): ValidatedSalesHistoryConfig {
  if (typeof config !== 'object' || config === null) throw invalid('the configuration is missing');
  const tops = config.topCodes;
  if (!Array.isArray(tops) || tops.length < 1 || tops.length > MAX_TOP_CODES) {
    throw invalid(`topCodes must list 1 to ${MAX_TOP_CODES} TOP codes`);
  }
  for (const top of tops) {
    if (typeof top !== 'number' || !Number.isSafeInteger(top) || top < 1 || top > 999_999) {
      throw invalid('every TOP code must be a positive integer');
    }
  }
  const statuses = config.statusCodes;
  if (!Array.isArray(statuses) || statuses.length < 1 || statuses.length > MAX_STATUS_CODES) {
    throw invalid(`statusCodes must list 1 to ${MAX_STATUS_CODES} status codes`);
  }
  for (const status of statuses) {
    if (typeof status !== 'string' || !/^[A-Z]$/.test(status)) throw invalid('every status code must be one uppercase letter');
  }
  const dateField = config.dateField ?? 'DTNEG';
  if (!SALES_HISTORY_DATE_FIELDS.includes(dateField)) throw invalid('dateField must be DTNEG or DTFATUR');

  let since: string;
  if (config.since !== undefined) {
    if (typeof config.since !== 'string' || validDay(config.since) === null) throw invalid('since must be a valid YYYY-MM-DD date');
    since = config.since;
  } else {
    const months = config.windowMonths ?? DEFAULT_SALES_HISTORY_WINDOW_MONTHS;
    if (typeof months !== 'number' || !Number.isInteger(months) || months < 1 || months > MAX_WINDOW_MONTHS) {
      throw invalid(`windowMonths must be an integer from 1 to ${MAX_WINDOW_MONTHS}`);
    }
    const reference = config.asOf ?? nowIso.slice(0, 10);
    const day = typeof reference === 'string' ? validDay(reference) : null;
    if (day === null) throw invalid('asOf must be a valid YYYY-MM-DD date');
    const first = new Date(Date.UTC(day.y, day.m - 1 - (months - 1), 1));
    since = first.toISOString().slice(0, 10);
  }
  return {
    topCodes: [...new Set(tops)].sort((a, b) => a - b),
    statusCodes: [...new Set(statuses)].sort(),
    dateField,
    since,
  };
}

/** The month number used in row keys: `YYYY-MM` to `YYYY * 100 + MM`. */
export function monthKey(month: string): number {
  return Number(month.slice(0, 4)) * 100 + Number(month.slice(5, 7));
}
