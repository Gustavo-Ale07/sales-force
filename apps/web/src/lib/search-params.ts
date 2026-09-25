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

/** Calendar date `YYYY-MM-DD` that really exists (no 31/02) and is in a plausible year; anything else is dropped. */
export function asDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  if (year < 1900 || year > 2100) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : undefined;
}

/**
 * List of non-negative integers as the router hands it over: an array (`[1,2]`), a single number (`?p=1`) or a
 * comma-separated string (`?p=1,2`). Invalid entries are dropped, duplicates removed, at most `max` kept.
 */
export function asIntList(value: unknown, max: number): number[] | undefined {
  const parts: unknown[] = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [value];
  const codes = [...new Set(parts.map((part) => asInt(typeof part === "string" ? part.trim() : part, 0)).filter((code): code is number => code !== undefined))];
  return codes.length > 0 ? codes.slice(0, max) : undefined;
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
