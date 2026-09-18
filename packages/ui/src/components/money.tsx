import type { ComponentProps } from "react";
import { cn } from "../lib/cn";
import {
  formatDate,
  formatDateTime,
  formatDocument,
  formatMoney,
  formatQuantity,
  isDecimalString,
  type DecimalString,
  type MoneyFormatOptions,
  type QuantityFormatOptions,
} from "../lib/format";

export interface MoneyProps extends Omit<ComponentProps<"span">, "children">, MoneyFormatOptions {
  /** Decimal string from the server (e.g. "1234.50"). Never a JavaScript number. */
  value: DecimalString | null | undefined;
}

/**
 * Money in pt-BR ("R$ 1.234,56"), right-aligned friendly. A missing value renders `fallback` in a muted style
 * (pass fallback="Sem preço" for prices: a missing price is never displayed as zero, CFG-5).
 */
export function Money({ value, fallback, minFractionDigits, maxFractionDigits, className, ...props }: MoneyProps) {
  const missing = !isDecimalString(value);
  return (
    <span
      data-missing={missing || undefined}
      className={cn("whitespace-nowrap tabular-nums", missing && "text-fg-faint", className)}
      {...props}
    >
      {formatMoney(value, { fallback, minFractionDigits, maxFractionDigits })}
    </span>
  );
}

export interface QuantityProps extends Omit<ComponentProps<"span">, "children">, QuantityFormatOptions {
  value: DecimalString | null | undefined;
  unit?: string;
}

export function Quantity({ value, unit, fallback, maxFractionDigits, className, ...props }: QuantityProps) {
  return (
    <span className={cn("whitespace-nowrap tabular-nums", className)} {...props}>
      {formatQuantity(value, { fallback, maxFractionDigits })}
      {unit && isDecimalString(value) ? <span className="ml-1 text-fg-muted">{unit}</span> : null}
    </span>
  );
}

export interface DateTextProps extends Omit<ComponentProps<"time">, "children" | "dateTime"> {
  value: string | Date | null | undefined;
  withTime?: boolean;
  fallback?: string;
  timeZone?: string;
}

/** dd/mm/aaaa (optionally with time) in a semantic <time> element. */
export function DateText({ value, withTime, fallback = "—", timeZone, ...props }: DateTextProps) {
  const text = withTime ? formatDateTime(value, { fallback, timeZone }) : formatDate(value, { fallback, timeZone });
  if (text === fallback || value == null) return <span className="text-fg-faint">{fallback}</span>;
  return (
    <time dateTime={typeof value === "string" ? value : value.toISOString()} {...props}>
      {text}
    </time>
  );
}

export interface DocumentTextProps extends Omit<ComponentProps<"span">, "children"> {
  /** CNPJ or CPF, digits or masked. */
  value: string | null | undefined;
}

export function DocumentText({ value, className, ...props }: DocumentTextProps) {
  return (
    <span className={cn("whitespace-nowrap font-mono text-xs", className)} {...props}>
      {formatDocument(value)}
    </span>
  );
}
