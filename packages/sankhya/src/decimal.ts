import type { DecimalString } from '@salesforce/domain';

/**
 * Minimal exact-decimal helpers for the ERP boundary. Values cross this package as unsigned plain
 * decimal strings without redundant trailing zeros (`"16.4300"` -> `"16.43"`, `"0.0"` -> `"0"`),
 * matching the domain's `DecimalString` and its storage scales (unit price numeric(18,6)).
 * No arithmetic on money happens here; this only validates and canonicalizes.
 */
const PLAIN_UNSIGNED = /^(\d+)(?:\.(\d+))?$/;

export const MAX_INTEGER_DIGITS = 12;
export const MAX_SCALE = 6;

/** Canonical form of a plain unsigned decimal string, or `null` when malformed or out of range. */
export function canonicalDecimal(input: string): DecimalString | null {
  const match = PLAIN_UNSIGNED.exec(input);
  if (!match) return null;
  const integer = (match[1] ?? '').replace(/^0+(?=\d)/, '');
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  if (integer.length > MAX_INTEGER_DIGITS || fraction.length > MAX_SCALE) return null;
  return fraction === '' ? integer : `${integer}.${fraction}`;
}

export type DecimalProblem = 'not_a_number' | 'negative' | 'out_of_range';

/**
 * Converts a raw JSON cell (number or numeric string) into a canonical decimal string.
 * Floats are formatted through `toFixed` at the storage scale so an exponent form never leaks.
 */
export function decimalFromCell(cell: unknown): { ok: true; value: DecimalString } | { ok: false; problem: DecimalProblem } {
  let text: string;
  if (typeof cell === 'number') {
    if (!Number.isFinite(cell)) return { ok: false, problem: 'not_a_number' };
    if (cell < 0) return { ok: false, problem: 'negative' };
    text = /e/i.test(String(cell)) ? cell.toFixed(MAX_SCALE + 1) : String(cell);
  } else if (typeof cell === 'string') {
    text = cell.trim();
    if (/^-\d/.test(text)) return { ok: false, problem: 'negative' };
  } else {
    return { ok: false, problem: 'not_a_number' };
  }
  const canonical = canonicalDecimal(text);
  if (canonical === null) {
    return { ok: false, problem: PLAIN_UNSIGNED.test(text) ? 'out_of_range' : 'not_a_number' };
  }
  return { ok: true, value: canonical };
}

/** Integer count of 10^-scale units to a canonical decimal string (1643 at scale 2 is "16.43"). Fixture helper. */
export function fixedToDecimal(units: number, scale: number): DecimalString {
  if (!Number.isSafeInteger(units) || units < 0) throw new RangeError('units must be a non-negative safe integer');
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE) throw new RangeError('scale out of range');
  const divisor = 10 ** scale;
  const whole = Math.floor(units / divisor);
  const fraction = scale === 0 ? '' : `.${String(units % divisor).padStart(scale, '0')}`;
  const canonical = canonicalDecimal(`${whole}${fraction}`);
  if (canonical === null) throw new RangeError('amount out of range');
  return canonical;
}
