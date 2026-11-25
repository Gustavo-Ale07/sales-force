import type { PriceOrigin } from "@salesforce/mobile-db";

export type PricesOrigin = PriceOrigin;

/** Same wording as the site (`priceContextSourceLabels`), so the seller reads the same origin on both. */
const SOURCE_LABEL: Readonly<Record<PricesOrigin["source"], string>> = {
  customer: "tabela do cliente",
  fallback: "tabela alternativa da instalação",
  catalog_reference: "tabela de referência do catálogo",
  none: "nenhuma tabela",
};

/** "Tabela 5 — Atacado (tabela do cliente)"; without a table, only the kind. Used by the list and by the product detail. */
export function priceOriginLabel(origin: PricesOrigin): string {
  if (origin.tableCode === null) return SOURCE_LABEL[origin.source];
  return `Tabela ${origin.tableCode}${origin.tableName !== null && origin.tableName !== "" ? ` — ${origin.tableName}` : ""} (${SOURCE_LABEL[origin.source]})`;
}
