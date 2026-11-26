import type { SellerChoice } from "./customer-form";

const FROM = "àáâãäåçèéêëìíîïñòóôõöùúûüýÿ";
const TO = "aaaaaaceeeeiiiinooooouuuuyy";

/** Lower case, no accents, single spaces: the form a seller's name and the typed text are compared in. Table-based, so it never depends on `String.normalize` support in Hermes. */
export function foldText(text: string): string {
  let out = "";
  for (const char of text.toLowerCase()) {
    const at = FROM.indexOf(char);
    out += at === -1 ? char : TO.charAt(at);
  }
  return out.trim().replace(/\s+/g, " ");
}

/** The sellers whose name contains every typed word (case and accent blind), in alphabetical order. No text = everyone. */
export function filterSellers(sellers: readonly SellerChoice[], query: string): SellerChoice[] {
  const words = foldText(query).split(" ").filter((word) => word !== "");
  return sellers
    .map((seller) => ({ seller, key: foldText(seller.name) }))
    .filter(({ key }) => words.every((word) => key.includes(word)))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.seller.code - b.seller.code))
    .map(({ seller }) => seller);
}
