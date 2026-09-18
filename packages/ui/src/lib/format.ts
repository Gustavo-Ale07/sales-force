/**
 * pt-BR display formatting. Money and quantities are DECIMAL STRINGS as provided by the server;
 * nothing here converts them to JavaScript `number` for arithmetic. `Intl.NumberFormat` receives the
 * string directly (exact decimal formatting) and is used for presentation only.
 */

/** A decimal serialised as text, e.g. "1234.50". */
export type DecimalString = string;

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;
const NBSP = " ";

const formatterCache = new Map<string, Intl.NumberFormat>();
function numberFormat(key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("pt-BR", options);
    formatterCache.set(key, formatter);
  }
  return formatter;
}

export function isDecimalString(value: unknown): value is DecimalString {
  return typeof value === "string" && DECIMAL_RE.test(value);
}

export interface MoneyFormatOptions {
  /** Text used when the value is null/undefined/invalid. Use "Sem preço" for missing prices. */
  fallback?: string;
  /** Minimum fraction digits (default 2). */
  minFractionDigits?: number;
  /** Maximum fraction digits (default 2; use up to 6 for unit prices). */
  maxFractionDigits?: number;
}

/** "1234.5" -> "R$ 1.234,50". */
export function formatMoney(value: DecimalString | null | undefined, options: MoneyFormatOptions = {}): string {
  const { fallback = "—", minFractionDigits = 2, maxFractionDigits = 2 } = options;
  if (!isDecimalString(value)) return fallback;
  const formatter = numberFormat(`brl:${minFractionDigits}:${maxFractionDigits}`, {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: minFractionDigits,
    maximumFractionDigits: maxFractionDigits,
  });
  return formatter.format(value as Intl.StringNumericLiteral);
}

export interface QuantityFormatOptions {
  fallback?: string;
  maxFractionDigits?: number;
}

/** "1500.5" -> "1.500,5". */
export function formatQuantity(value: DecimalString | null | undefined, options: QuantityFormatOptions = {}): string {
  const { fallback = "—", maxFractionDigits = 4 } = options;
  if (!isDecimalString(value)) return fallback;
  const formatter = numberFormat(`qty:${maxFractionDigits}`, { maximumFractionDigits: maxFractionDigits });
  return formatter.format(value as Intl.StringNumericLiteral);
}

/** "64" -> "64,0%" (value is already a percentage, not a ratio). */
export function formatPercent(value: DecimalString | null | undefined, fractionDigits = 1, fallback = "—"): string {
  if (!isDecimalString(value)) return fallback;
  const formatter = numberFormat(`pct:${fractionDigits}`, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  return `${formatter.format(value as Intl.StringNumericLiteral)}%`;
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DateFormatOptions {
  fallback?: string;
  /** IANA time zone for instants (default: the browser's). Date-only values are never shifted. */
  timeZone?: string;
}

/** ISO date "2026-09-18" or instant -> "18/09/2026". */
export function formatDate(value: string | Date | null | undefined, options: DateFormatOptions = {}): string {
  const { fallback = "—", timeZone } = options;
  if (value == null || value === "") return fallback;
  if (typeof value === "string") {
    const match = DATE_ONLY_RE.exec(value);
    if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone }).format(date);
}

/** Instant -> "18/09/2026 14:05". */
export function formatDateTime(value: string | Date | null | undefined, options: DateFormatOptions = {}): string {
  const { fallback = "—", timeZone } = options;
  if (value == null || value === "") return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const parts = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).formatToParts(date);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("day")}/${pick("month")}/${pick("year")} ${pick("hour")}:${pick("minute")}`;
}

/** Relative age of an instant in pt-BR ("há 25 min"); presentation only. */
export function formatRelativeTime(value: string | Date | null | undefined, now: Date = new Date(), fallback = "—"): string {
  if (value == null || value === "") return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(seconds, "second");
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  return rtf.format(Math.round(seconds / 86400), "day");
}

function stripDocument(value: string): string {
  return value.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

/** CNPJ (numeric or alphanumeric): "11111111000111" -> "11.111.111/0001-11". */
export function formatCnpj(value: string | null | undefined, fallback = "—"): string {
  if (!value) return fallback;
  const d = stripDocument(value);
  if (!/^[0-9A-Z]{14}$/.test(d)) return value;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** CPF: "12345678901" -> "123.456.789-01". */
export function formatCpf(value: string | null | undefined, fallback = "—"): string {
  if (!value) return fallback;
  const d = stripDocument(value);
  if (!/^\d{11}$/.test(d)) return value;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** CNPJ when 14 characters, CPF when 11 digits; otherwise the input unchanged. */
export function formatDocument(value: string | null | undefined, fallback = "—"): string {
  if (!value) return fallback;
  const d = stripDocument(value);
  if (d.length === 14) return formatCnpj(value, fallback);
  if (d.length === 11) return formatCpf(value, fallback);
  return value;
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

export { NBSP };
