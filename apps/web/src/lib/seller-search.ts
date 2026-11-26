export interface SearchableSeller {
  code: number;
  name: string;
  active?: boolean;
}

/** Lower case, no accents, trimmed: what the seller search compares. */
export function normalizeSearch(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").trim();
}

/** Active sellers whose name contains the typed text, alphabetical (pt-BR, accent/case-insensitive). */
export function filterSellers<T extends SearchableSeller>(sellers: readonly T[], query: string): T[] {
  const needle = normalizeSearch(query);
  return sellers
    .filter((seller) => seller.active !== false && normalizeSearch(seller.name).includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
}
