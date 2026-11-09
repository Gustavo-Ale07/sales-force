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
/** Discount percentage: numeric(5,2), 0 to 99.99. A technical bound of the value, NOT an authority limit (P-10; R35/R36 UNDECIDED). */
export const DISCOUNT_SCALE = 2;
export const MAX_DISCOUNT_PERCENT: DecimalString = '99.99';
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

/** Discount percentage of a line: zero or positive, at most 2 decimals, at most 99.99. Returns the canonical string. */
export function validateDiscountPercent(input: string): Result<DecimalString, DecimalError> {
  const parsed = parseUnsigned(input);
  if (!parsed) return err(malformedReason(input));
  if (parsed.scale > DISCOUNT_SCALE) return err('too_many_decimals');
  if (parsed.value.greaterThan(MAX_DISCOUNT_PERCENT)) return err('out_of_range');
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

/**
 * Unit discount the ERP applies (D-AK, Sankhya rule seen in notes 2491/2492/2500): unit price x percentage / 100,
 * rounded half-up to 2 decimals PER UNIT. Inputs must already be valid.
 */
export function computeUnitDiscount(unitPrice: DecimalString, discountPercent: DecimalString): DecimalString {
  const p = parseUnsigned(unitPrice);
  const d = parseUnsigned(discountPercent);
  if (!p || !d) throw new RangeError('Malformed decimal string');
  return p.value.mul(d.value).div(100).toDecimalPlaces(DISCOUNT_SCALE, Decimal.ROUND_HALF_UP).toFixed(DISCOUNT_SCALE);
}

/** Discount amount of a line, as the ERP stores it in VLRDESC: quantity x the per-unit rounded discount (D-AK). */
export function computeLineDiscountAmount(
  quantity: DecimalString,
  unitPrice: DecimalString,
  discountPercent: DecimalString,
): DecimalString {
  const q = parseUnsigned(quantity);
  if (!q) throw new RangeError('Malformed decimal string');
  const unit = new Decimal(computeUnitDiscount(unitPrice, discountPercent));
  return q.value.mul(unit).toDecimalPlaces(TOTAL_SCALE, Decimal.ROUND_HALF_UP).toFixed(TOTAL_SCALE);
}

/**
 * Net line total with a percentage discount, by the Sankhya rule (D-AK): quantity x (unit price - per-unit discount
 * rounded to 2 decimals), rounded half-up to 2 decimals. A discount of "0" gives exactly `computeLineTotal`.
 * Single shared calculation for editor, PDF, server totals, IPI base and the D-7 reread. Inputs must already be valid.
 */
export function computeDiscountedLineTotal(
  quantity: DecimalString,
  unitPrice: DecimalString,
  discountPercent: DecimalString,
): DecimalString {
  const q = parseUnsigned(quantity);
  const p = parseUnsigned(unitPrice);
  if (!q || !p) throw new RangeError('Malformed decimal string');
  const unit = new Decimal(computeUnitDiscount(unitPrice, discountPercent));
  return q.value.mul(p.value.minus(unit)).toDecimalPlaces(TOTAL_SCALE, Decimal.ROUND_HALF_UP).toFixed(TOTAL_SCALE);
}

/**
 * Estimated IPI of a line: net line total x rate / 100, rounded half-up to 2 decimals ONCE (D-D). The net total is
 * quantity x unit price - item discount. An estimate for display only: the ERP calculates the real IPI.
 */
export function estimateItemIpi(lineNetTotal: DecimalString, percentual: DecimalString): DecimalString {
  const t = parseUnsigned(lineNetTotal);
  const r = parseUnsigned(percentual);
  if (!t || !r) throw new RangeError('Malformed decimal string');
  return t.value.mul(r.value).div(100).toDecimalPlaces(TOTAL_SCALE, Decimal.ROUND_HALF_UP).toFixed(TOTAL_SCALE);
}

/** Unit price after the discount (list - per-unit rounded discount, D-AK), for display: at most 6 decimals, trailing zeros dropped. */
export function computeNetUnitPrice(unitPrice: DecimalString, discountPercent: DecimalString): DecimalString {
  const p = parseUnsigned(unitPrice);
  if (!p) throw new RangeError('Malformed decimal string');
  return p.value.minus(computeUnitDiscount(unitPrice, discountPercent)).toDecimalPlaces(UNIT_PRICE_SCALE, Decimal.ROUND_HALF_UP).toFixed();
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

/** Difference of two already-rounded totals (`minuend` - `subtrahend`), exactly 2 decimals. The caller keeps the minuend >= the subtrahend. */
export function subtractTotals(minuend: DecimalString, subtrahend: DecimalString): DecimalString {
  const a = parseUnsigned(minuend);
  const b = parseUnsigned(subtrahend);
  if (!a || !b) throw new RangeError('Malformed decimal string');
  return a.value.minus(b.value).toDecimalPlaces(TOTAL_SCALE, Decimal.ROUND_HALF_UP).toFixed(TOTAL_SCALE);
}

/**
 * Exact sum of quantities (up to QUANTITY_SCALE decimals, trailing zeros dropped). Quantities of different units
 * must not be added together by the caller; this only adds numbers.
 */
export function sumQuantities(quantities: readonly DecimalString[]): DecimalString {
  let sum = new Decimal(0);
  for (const quantity of quantities) {
    const parsed = parseUnsigned(quantity);
    if (!parsed) throw new RangeError('Malformed decimal string');
    sum = sum.plus(parsed.value);
  }
  return sum.toDecimalPlaces(QUANTITY_SCALE, Decimal.ROUND_HALF_UP).toFixed();
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
