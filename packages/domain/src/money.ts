import { Decimal as BaseDecimal } from 'decimal.js';
import { err, ok, type Result } from './result.js';

/**
 * Exact decimal arithmetic (DATA-3: money never uses JavaScript `number`).
 * Values cross every boundary (API, database, clients) as decimal strings.
 *
 * All amounts here are ESTIMATES derived from the list price only. This module deliberately
 * knows no ERP total formula: the final value is calculated by the ERP.
 */
const Decimal = BaseDecimal.clone({
  precision: 60,
  rounding: BaseDecimal.ROUND_HALF_UP,
  toExpNeg: -1_000_000,
  toExpPos: 1_000_000,
});
type Decimal = BaseDecimal;

/** A decimal number in plain notation (`"12"`, `"12.5"`, `"0.005"`). No sign, exponent or separators. */
export type DecimalString = string;

/** Scale limits mirror the storage precision: quantity numeric(14,4), price numeric(18,6), total numeric(14,2). */
export const QUANTITY_SCALE = 4;
export const UNIT_PRICE_SCALE = 6;
export const TOTAL_SCALE = 2;
const QUANTITY_MAX_INTEGER_DIGITS = 10;
const UNIT_PRICE_MAX_INTEGER_DIGITS = 12;
const TOTAL_MAX_INTEGER_DIGITS = 12;

const UNSIGNED_DECIMAL = /^(\d+)(?:\.(\d+))?$/;

export type DecimalError = 'not_a_decimal' | 'not_positive' | 'negative' | 'too_many_decimals' | 'out_of_range';

interface ParsedDecimal {
  readonly value: Decimal;
  readonly integerDigits: number;
  readonly scale: number;
}

function parseUnsigned(input: string): ParsedDecimal | null {
  if (typeof input !== 'string') return null;
  const match = UNSIGNED_DECIMAL.exec(input);
  if (!match) return null;
  const integerPart = (match[1] ?? '').replace(/^0+(?=\d)/, '');
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  return {
    value: new Decimal(input),
    integerDigits: integerPart === '0' ? 1 : integerPart.length,
    scale: fraction.length,
  };
}

function malformedReason(input: unknown): DecimalError {
  return typeof input === 'string' && /^-\d/.test(input) ? 'negative' : 'not_a_decimal';
}

/** True when the string is a well-formed non-negative plain decimal. */
export function isDecimalString(input: string): boolean {
  return parseUnsigned(input) !== null;
}

/** Canonical plain form without redundant trailing zeros (`"2.5000"` -> `"2.5"`). Throws on malformed input. */
export function normalizeDecimalString(input: DecimalString): DecimalString {
  const parsed = parseUnsigned(input);
  if (!parsed) throw new RangeError('Malformed decimal string');
  return parsed.value.toFixed();
}

export function compareDecimalStrings(a: DecimalString, b: DecimalString): -1 | 0 | 1 {
  const left = parseUnsigned(a);
  const right = parseUnsigned(b);
  if (!left || !right) throw new RangeError('Malformed decimal string');
  return left.value.comparedTo(right.value) as -1 | 0 | 1;
}

export function decimalEquals(a: DecimalString, b: DecimalString): boolean {
  return compareDecimalStrings(a, b) === 0;
}

/** Quantity: strictly positive, at most 4 decimals. Returns the canonical string. */
export function validateQuantity(input: string): Result<DecimalString, DecimalError> {
  const parsed = parseUnsigned(input);
  if (!parsed) return err(malformedReason(input));
  if (parsed.value.isZero()) return err('not_positive');
  if (parsed.scale > QUANTITY_SCALE) return err('too_many_decimals');
  if (parsed.integerDigits > QUANTITY_MAX_INTEGER_DIGITS) return err('out_of_range');
  return ok(parsed.value.toFixed());
}

/** Unit list price: zero or positive, at most 6 decimals. Returns the canonical string. */
export function validateUnitPrice(input: string): Result<DecimalString, DecimalError> {
  const parsed = parseUnsigned(input);
  if (!parsed) return err(malformedReason(input));
  if (parsed.scale > UNIT_PRICE_SCALE) return err('too_many_decimals');
  if (parsed.integerDigits > UNIT_PRICE_MAX_INTEGER_DIGITS) return err('out_of_range');
  return ok(parsed.value.toFixed());
}

/**
 * Estimated line total = quantity x unit list price, rounded half-up to 2 decimals.
 * Rounded once, on the exact product. Inputs must already be valid (see the validators).
 */
export function computeLineTotal(quantity: DecimalString, unitPrice: DecimalString): DecimalString {
  const q = parseUnsigned(quantity);
  const p = parseUnsigned(unitPrice);
  if (!q || !p) throw new RangeError('Malformed decimal string');
  return q.value.mul(p.value).toDecimalPlaces(TOTAL_SCALE, Decimal.ROUND_HALF_UP).toFixed(TOTAL_SCALE);
}

/** Sum of already-rounded line totals, always with exactly 2 decimals. Empty sum is `"0.00"`. */
export function sumTotals(totals: readonly DecimalString[]): DecimalString {
  let sum = new Decimal(0);
  for (const total of totals) {
    const parsed = parseUnsigned(total);
    if (!parsed) throw new RangeError('Malformed decimal string');
    sum = sum.plus(parsed.value);
  }
  return sum.toDecimalPlaces(TOTAL_SCALE, Decimal.ROUND_HALF_UP).toFixed(TOTAL_SCALE);
}

/** True when the total fits numeric(14,2). */
export function isTotalInRange(total: DecimalString): boolean {
  const parsed = parseUnsigned(total);
  return parsed !== null && parsed.integerDigits <= TOTAL_MAX_INTEGER_DIGITS;
}

export function isZeroDecimal(input: DecimalString): boolean {
  const parsed = parseUnsigned(input);
  if (!parsed) throw new RangeError('Malformed decimal string');
  return parsed.value.isZero();
}
