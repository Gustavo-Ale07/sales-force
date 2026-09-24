import { normalizeDecimalString } from "@salesforce/domain";
import type { ListPriceContext } from "../data/ports";

/**
 * Formats a decimal string (`"1234.5"`) as pt-BR currency (`"R$ 1.234,50"`) without ever going through a
 * JavaScript `number` (DATA-3). Two fraction digits are always shown; further significant digits of a unit
 * price are kept up to the value's own scale. Returns `null` for anything that is not a plain decimal.
 */
export function formatBrl(value: string): string | null {
  let plain: string;
  try {
    plain = normalizeDecimalString(value);
  } catch {
    return null;
  }
  const [integer = "0", fraction = ""] = plain.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${grouped},${fraction.padEnd(2, "0")}`;
}

/**
 * Text of a list price. A missing price is "Sem preço", never zero (CFG rule, P-09); an explicit zero row is
 * shown as zero. This only presents what the server resolved; it never computes or replaces a price.
 */
export function describeListPrice(price: ListPriceContext): string {
  if (price.state === "none") return "Sem preço";
  return formatBrl(price.unitPrice) ?? "Preço indisponível";
}
