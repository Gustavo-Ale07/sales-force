import { parseQuantityInput, quantityProblemMessages, type QuantityProblem } from "./order-draft";
import type { ListPriceContext, Page, ProductListItem, ProductPageRequest, ProductRepository } from "./ports";

/**
 * Multi-line entry ("lançamento múltiplo"): pasted text, one `identifier;quantity` per line (same format and rules as the
 * site, `apps/web/src/lib/bulk-entry.ts`). The identifiers are resolved against the catalog of the device (code or reference,
 * exact match, never fuzzy), so the whole flow also works offline. Prices and every rule are revalidated by the server when
 * the order is sent; nothing here computes money.
 */

export const MAX_ENTRY_CHARS = 20 * 1024 * 1024;
export const MAX_ENTRY_ROWS = 50_000;
/** Same cap as the API contract for one order (items). */
export const MAX_ORDER_ROWS = 500;
/** Longest identifier the API accepts. */
export const MAX_IDENTIFIER_LENGTH = 40;

export type EntryProblem = QuantityProblem | "identifier_too_long";

export interface EntryRow {
  /** 1-based line of the pasted text (header and blank lines count). */
  readonly line: number;
  readonly identifier: string;
  /** As typed (pt-BR); "1" when the line only has the identifier. */
  readonly quantityText: string;
  readonly problem: EntryProblem | null;
}

export type EntryParse =
  | { readonly ok: true; readonly rows: readonly EntryRow[]; /** Valid-looking lines beyond what one order can hold. */ readonly skipped: number }
  | { readonly ok: false; readonly reason: "empty" | "too_large" | "too_many_rows" };

export const entryFailureMessages = {
  empty: "Nada para conferir: cole linhas no formato código;quantidade.",
  too_large: "O conteúdo é grande demais.",
  too_many_rows: `O conteúdo tem linhas demais (limite de ${MAX_ENTRY_ROWS}). Divida em partes menores.`,
} as const;

const HEADER_QUANTITY = /^(qtd|qtde|quant|qty|quantity)/i;
// C0, DEL and C1 (the API rejects all of them; one stray NEL must not fail the whole batch).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

function countLines(text: string): number {
  let lines = 0;
  for (let index = 0; index < text.length; index += 1) if (text.charCodeAt(index) === 10) lines += 1;
  return text.endsWith("\n") ? lines : lines + 1;
}

function unquote(field: string): string {
  const trimmed = field.trim();
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1).trim() : trimmed;
}

export function parseBulkEntry(text: string): EntryParse {
  if (text.length > MAX_ENTRY_CHARS) return { ok: false, reason: "too_large" };
  if (countLines(text) > MAX_ENTRY_ROWS) return { ok: false, reason: "too_many_rows" };

  const rows: EntryRow[] = [];
  let skipped = 0;
  let sawContent = false;
  const lines = text.split(/\r\n|\n|\r/);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    if (raw.trim() === "") continue;
    const fields = (raw.includes("\t") ? raw.split("\t") : raw.split(";")).map(unquote);
    const isFirstContent = !sawContent;
    sawContent = true;
    if (isFirstContent && fields.length > 1 && HEADER_QUANTITY.test(fields[1] ?? "")) continue;

    const identifier = (fields[0] ?? "").replace(CONTROL_CHARS, "").trim();
    const quantityText = fields.length > 1 ? (fields[1] ?? "") : "1";
    if (identifier === "") continue;
    if (rows.length >= MAX_ORDER_ROWS) {
      skipped += 1;
      continue;
    }
    let problem: EntryProblem | null = null;
    if (identifier.length > MAX_IDENTIFIER_LENGTH) problem = "identifier_too_long";
    else {
      const quantity = parseQuantityInput(quantityText);
      if (!quantity.ok) problem = quantity.problem;
    }
    rows.push({ line: index + 1, identifier, quantityText, problem });
  }
  if (rows.length === 0 && skipped === 0) return { ok: false, reason: "empty" };
  return { ok: true, rows, skipped };
}

export type SkipReason = EntryProblem | "not_found" | "ambiguous" | "not_sellable" | "price_blocked" | "duplicate_in_file" | "already_in_order";

export const skipReasonMessages: Record<SkipReason, string> = {
  ...quantityProblemMessages,
  identifier_too_long: "Código ou referência longo demais.",
  not_found: "Produto não encontrado.",
  ambiguous: "Mais de um produto com este código ou referência. Adicione pela busca.",
  not_sellable: "Produto não está disponível para venda.",
  price_blocked: "Item sem preço não pode ser pedido nesta instalação.",
  duplicate_in_file: "Produto repetido nas linhas: só a primeira ocorrência entra.",
  already_in_order: "Produto já está no pedido.",
};

/** Answer for one identifier, same shape as the site's resolution (`found` / `ambiguous` / `not_found`). */
export interface Resolution {
  readonly identifier: string;
  readonly status: "found" | "ambiguous" | "not_found";
  readonly product?: ProductListItem;
  readonly candidates?: readonly ProductListItem[];
}

export interface PlannedRow {
  readonly row: EntryRow;
  /** Set when the row resolved to one product (even when it is left out afterwards). */
  readonly product: ProductListItem | null;
  /** Products an ambiguous identifier could mean. */
  readonly candidates: readonly ProductListItem[];
  /** Why the row is left out; `null` = it will be added. */
  readonly skip: SkipReason | null;
}

export interface PlanContext {
  readonly existingCodes: ReadonlySet<number>;
  readonly isPriceOrderable: (state: ListPriceContext["state"]) => boolean;
}

/** The identifiers to resolve: the rows that have no problem, in order. */
export function identifiersToResolve(rows: readonly EntryRow[]): string[] {
  return rows.filter((row) => row.problem === null).map((row) => row.identifier);
}

/**
 * Decides, row by row, what an import does. Nothing is silently dropped or summed: every row that is left out carries a
 * reason. `resolutions` answers `identifiersToResolve(rows)` position by position.
 */
export function planEntry(rows: readonly EntryRow[], resolutions: readonly Resolution[], context: PlanContext): PlannedRow[] {
  const toResolve = identifiersToResolve(rows);
  if (resolutions.length !== toResolve.length || resolutions.some((item, index) => item.identifier !== toResolve[index])) {
    throw new Error("A resolução de produtos não corresponde às linhas.");
  }
  const seen = new Set<number>();
  let cursor = 0;
  return rows.map((row): PlannedRow => {
    if (row.problem !== null) return { row, product: null, candidates: [], skip: row.problem };
    const resolution = resolutions[cursor];
    cursor += 1;
    if (resolution === undefined || resolution.status === "not_found") return { row, product: null, candidates: [], skip: "not_found" };
    if (resolution.status === "ambiguous") return { row, product: null, candidates: resolution.candidates ?? [], skip: "ambiguous" };
    const product = resolution.product ?? null;
    if (product === null) return { row, product: null, candidates: [], skip: "not_found" };
    const skip = ((): SkipReason | null => {
      if (context.existingCodes.has(product.code)) return "already_in_order";
      if (seen.has(product.code)) return "duplicate_in_file";
      seen.add(product.code);
      if (!product.sellable) return "not_sellable";
      if (!context.isPriceOrderable(product.listPrice.state)) return "price_blocked";
      return null;
    })();
    return { row, product, candidates: [], skip };
  });
}

const NO_PRICE: ListPriceContext = { state: "none", tableCode: null, versionId: null, noPriceReason: "no_price_row" };
const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const CODE_IDENTIFIER = /^[1-9]\d*$/;
const PARALLEL = 8;

/** Exact, case-sensitive: the product code (digits without leading zeros) or the reference. Never a wildcard. */
function matches(identifier: string, product: ProductListItem): boolean {
  return (CODE_IDENTIFIER.test(identifier) && String(product.code) === identifier) || product.reference === identifier;
}

/**
 * The products of the device catalog that the search text finds and `accept` keeps (an exact test, never a part of a text),
 * ordered by code. At most the first 500 products the search finds are looked at.
 */
export async function searchExact(
  products: ProductRepository,
  search: string,
  customerCode: number | undefined,
  accept: (product: ProductListItem) => boolean,
): Promise<ProductListItem[]> {
  const found = new Map<number, ProductListItem>();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const request: ProductPageRequest = { search, page, pageSize: PAGE_SIZE, ...(customerCode === undefined ? {} : { customerCode }) };
    const result: Page<ProductListItem> = await products.list(request);
    for (const product of result.items) if (accept(product)) found.set(product.code, product);
    if (result.items.length < PAGE_SIZE || page * PAGE_SIZE >= result.total) break;
  }
  return [...found.values()].sort((a, b) => a.code - b.code);
}

const lookup = (products: ProductRepository, identifier: string, customerCode: number | undefined) =>
  searchExact(products, identifier, customerCode, (product) => matches(identifier, product));

/**
 * Resolves identifiers on the catalog of the device (the catalog list of the order customer shows only products priced in the
 * customer table: a product found only without the customer is reported with "Sem preço", never with a guessed price).
 * A duplicate identifier is answered at each position, in request order.
 */
export async function resolveIdentifiers(products: ProductRepository, customerCode: number, identifiers: readonly string[]): Promise<Resolution[]> {
  const unique = [...new Set(identifiers)];
  const answers = new Map<string, Resolution>();
  const resolveOne = async (identifier: string): Promise<void> => {
    let hits = await lookup(products, identifier, customerCode);
    if (hits.length === 0) {
      const withoutPrice = await lookup(products, identifier, undefined);
      hits = withoutPrice.map((product) => ({ ...product, listPrice: NO_PRICE }));
    }
    const [first, ...rest] = hits;
    if (first === undefined) answers.set(identifier, { identifier, status: "not_found" });
    else if (rest.length === 0) answers.set(identifier, { identifier, status: "found", product: first });
    else answers.set(identifier, { identifier, status: "ambiguous", candidates: hits.slice(0, 5) });
  };
  for (let start = 0; start < unique.length; start += PARALLEL) {
    await Promise.all(unique.slice(start, start + PARALLEL).map(resolveOne));
  }
  return identifiers.map((identifier) => answers.get(identifier) ?? { identifier, status: "not_found" });
}
