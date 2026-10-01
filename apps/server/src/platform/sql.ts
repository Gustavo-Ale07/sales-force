import { isValidSellerCode } from '@salesforce/domain';
import { ilike, sql, type Column, type SQL } from 'drizzle-orm';

/** Largest value of a PostgreSQL `integer` column: a bigger code can never match a row (and would raise a DB error). */
export const PG_INT_MAX = 2_147_483_647;

/** Contract codes are unbounded integers; anything above `integer` range matches nothing. */
export function fitsPgInt(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= PG_INT_MAX;
}

/** `column = value`, or "never" when the value cannot be stored in an `integer` column. */
export function eqInt(column: Column, value: number): SQL {
  return fitsPgInt(value) ? sql`${column} = ${value}` : sql`false`;
}

/** `column IN (values)`, tolerating an empty list (matches nothing) and out-of-range values (dropped). */
export function inInts(column: Column, values: readonly number[]): SQL {
  const usable = [...new Set(values.filter(fitsPgInt))];
  if (usable.length === 0) return sql`false`;
  return sql`${column} in (${sql.join(
    usable.map((value) => sql`${value}`),
    sql`, `,
  )})`;
}

/** Seller-scope variant of `inInts`: only valid seller codes (>= 1) can match; 0 is never a seller (F2). */
export function inSellerCodes(column: Column, values: readonly number[]): SQL {
  return inInts(column, values.filter(isValidSellerCode));
}

/** Escapes LIKE wildcards so a search term is always matched literally. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Case-insensitive "contains" (served by the trigram indexes of the mirror tables). */
export function containsText(column: Column, term: string): SQL {
  return ilike(column, `%${escapeLike(term)}%`);
}

/** Digits-only search input (code, draft number, tax id), tolerating `.`, `-`, `/` punctuation. */
export function digitsOf(term: string): string | null {
  const stripped = term.replace(/[.\-/\s]/g, '');
  return /^\d+$/.test(stripped) ? stripped : null;
}

export function offsetOf(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}
