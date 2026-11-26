/**
 * Display-only formatting of customer names and documents, same result as the site (`titleCase` and `formatDocument` of
 * `packages/ui`, which the app cannot import). Never use the result as a key or send it back to the server.
 */

const TITLE_CASE_LOWER = new Set(["a", "as", "o", "os", "e", "de", "da", "das", "do", "dos", "em", "na", "nas", "no", "nos", "para", "com", "c/", "p/", "cm", "mm", "ml", "kg"]);
const TITLE_CASE_UPPER = new Set(["ltda", "me", "epp", "eireli", "sa", "s/a", "mei"]);

/** "DOCES DA VOVÓ LTDA" -> "Doces da Vovó LTDA"; a name already in mixed case is left as it is. */
export function titleCase(value: string | null | undefined): string {
  if (!value) return "";
  if (value !== value.toLocaleUpperCase("pt-BR")) return value;
  return value
    .toLocaleLowerCase("pt-BR")
    .split(/(\s+)/)
    .map((token, index) => {
      if (token.trim() === "") return token;
      if (/\d/.test(token)) return token.toLocaleUpperCase("pt-BR");
      if (TITLE_CASE_UPPER.has(token)) return token.toLocaleUpperCase("pt-BR");
      if (index > 0 && TITLE_CASE_LOWER.has(token)) return token;
      return token.charAt(0).toLocaleUpperCase("pt-BR") + token.slice(1);
    })
    .join("");
}

/** CNPJ (14 characters) as "11.111.111/0001-11", CPF (11 digits) as "123.456.789-01"; anything else unchanged. */
export function formatDocument(value: string | null | undefined, fallback = "—"): string {
  if (!value) return fallback;
  const d = value.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (/^[0-9A-Z]{14}$/.test(d)) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (/^\d{11}$/.test(d)) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return value;
}
