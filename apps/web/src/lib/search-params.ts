/**
 * Defensive readers for URL search params. The router JSON-parses values, so `?q=123` arrives as a number and
 * `?x=true` as a boolean; anything unexpected is dropped instead of reaching the API.
 */

export function asString(value: unknown, maxLength = 100): string | undefined {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value : undefined;
  const trimmed = text?.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : undefined;
}

export function asInt(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : undefined;
  return number !== undefined && Number.isInteger(number) && number >= min && number <= max ? number : undefined;
}

export function asOneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export const PAGE_SIZES = [25, 50, 100] as const;

export function asPageSize(value: unknown): number {
  const size = asInt(value, 1, 100);
  return size !== undefined && (PAGE_SIZES as readonly number[]).includes(size) ? size : 25;
}

/** Removes `undefined` entries so the router does not serialise them and defaults stay out of the URL. */
export function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
