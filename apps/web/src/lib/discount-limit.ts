import { parseDiscountInput, type EditorLine } from "./order-draft";

/**
 * Per-product discount ceiling (ERP registry, `maxDiscountPercent`). `null`/absent/unparseable = no limit registered = no warning.
 * Informational only: it never blocks saving or sending (the server and the discount authority decide).
 */

const SCALE = 6;

/** Decimal text ("12", "12.5", "12,50") to an integer scaled by 10^6, so comparisons never use floating point. */
function scaled(text: string): bigint | null {
  const match = /^(\d{1,3})(?:[.,](\d{1,6}))?$/.exec(text.trim());
  if (!match) return null;
  return BigInt(match[1]! + (match[2] ?? "").padEnd(SCALE, "0"));
}

/** The limit as a usable decimal, or `null` when there is none. */
export function limitOf(limit: string | null | undefined): string | null {
  if (limit === null || limit === undefined) return null;
  return scaled(limit) === null ? null : limit.trim();
}

/** "12" -> "12", "12.50" -> "12,5": short text for the limit hint. */
export function formatLimit(limit: string): string {
  const [int, frac = ""] = limit.trim().replace(",", ".").split(".");
  const trimmed = frac.replace(/0+$/, "");
  return trimmed === "" ? (int ?? "") : `${int}.${trimmed}`.replace(".", ",");
}

/** True when the typed discount text is a valid percentage strictly above the product limit. */
export function exceedsLimit(discountText: string, limit: string | null | undefined): boolean {
  const known = limitOf(limit);
  if (known === null) return false;
  const parsed = parseDiscountInput(discountText);
  if (!parsed.ok) return false;
  const typed = scaled(parsed.value);
  const max = scaled(known);
  return typed !== null && max !== null && typed > max;
}

export function lineExceedsLimit(line: Pick<EditorLine, "discountText" | "price" | "maxDiscountPercent">): boolean {
  return line.price.state !== "none" && exceedsLimit(line.discountText, line.maxDiscountPercent);
}

export interface AboveLimitEntry {
  name: string;
  limit: string;
  typed: string;
}

/** Splits the lines a bulk operation changed into those within the limit and those above it. */
export function classifyBulk(
  before: readonly EditorLine[],
  after: readonly EditorLine[],
): { within: number; withinNames: string[]; above: AboveLimitEntry[] } {
  const previous = new Map(before.map((line) => [line.key, line]));
  const withinNames: string[] = [];
  const above: AboveLimitEntry[] = [];
  for (const line of after) {
    const old = previous.get(line.key);
    if (!old || old.discountText === line.discountText || line.price.state === "none") continue;
    const parsed = parseDiscountInput(line.discountText);
    if (!parsed.ok || parsed.value === "0") continue;
    if (lineExceedsLimit(line)) above.push({ name: line.description, limit: formatLimit(limitOf(line.maxDiscountPercent)!), typed: formatLimit(parsed.value) });
    else withinNames.push(line.description);
  }
  return { within: withinNames.length, withinNames, above };
}
