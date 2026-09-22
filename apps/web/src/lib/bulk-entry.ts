import type { ApiSchema } from "@salesforce/contracts/client";
import { parseQuantityInput, quantityProblemMessages, type QuantityProblem } from "./order-draft";
import type { ProductRow } from "./price-types";

/**
 * Multi-line entry ("lançamento múltiplo"): pasted text or a CSV read in the browser, one `identifier;quantity`
 * per line. Nothing here talks to the server or decides prices: the identifiers are resolved by the API and the
 * server revalidates everything when the draft is saved.
 */

/** Upload/paste size limit, checked before any parsing (security-model input limits). */
export const MAX_ENTRY_BYTES = 20 * 1024 * 1024;
export const MAX_ENTRY_CHARS = MAX_ENTRY_BYTES;
export const MAX_ENTRY_ROWS = 50_000;
/** Same cap as the API contracts for one order (items) and for one resolution request (identifiers). */
export const MAX_ORDER_ROWS = 500;
/** Longest identifier the resolution endpoint accepts. */
export const MAX_IDENTIFIER_LENGTH = 40;

export type EntryProblem = QuantityProblem | "identifier_too_long";

export interface EntryRow {
  /** 1-based line of the pasted text or file (header and blank lines count). */
  line: number;
  identifier: string;
  /** As typed (pt-BR); "1" when the line only has the identifier. */
  quantityText: string;
  problem: EntryProblem | null;
}

export type EntryParse =
  | {
      ok: true;
      rows: EntryRow[];
      /** Valid-looking lines beyond what one order can hold. */ skipped: number;
    }
  | { ok: false; reason: "empty" | "too_large" | "too_many_rows" };

export const entryFailureMessages = {
  empty: "Nada para importar: cole ou selecione linhas no formato código;quantidade.",
  too_large: "O conteúdo é grande demais (limite de 20 MB).",
  too_many_rows: `O conteúdo tem linhas demais (limite de ${MAX_ENTRY_ROWS.toLocaleString("pt-BR")}). Divida em arquivos menores.`,
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

export type SkipReason =
  EntryProblem | "not_found" | "ambiguous" | "not_sellable" | "price_blocked" | "duplicate_in_file" | "already_in_order";

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

export interface PlannedRow {
  row: EntryRow;
  /** Set when the row resolved to one product (even when it is left out afterwards). */
  product: ProductRow | null;
  /** Products an ambiguous identifier could mean. */
  candidates: ProductRow[];
  /** Why the row is left out; `null` = it will be added. */
  skip: SkipReason | null;
}

export interface PlanContext {
  existingCodes: ReadonlySet<number>;
  isPriceOrderable: (state: "priced" | "zero" | "none") => boolean;
}

/** The identifiers to send to the resolution endpoint: the rows that have no problem, in order. */
export function identifiersToResolve(rows: readonly EntryRow[]): string[] {
  return rows.filter((row) => row.problem === null).map((row) => row.identifier);
}

// The typed client drops `null` price fields (see ListPrice), so the response type is narrowed in one place.
type ResolvedProduct = Omit<ApiSchema<"ProductListItem">, "listPrice"> & { listPrice: object };
export type Resolution = Omit<ApiSchema<"ProductResolutionItem">, "product" | "candidates"> & {
  product?: ResolvedProduct;
  candidates?: ResolvedProduct[];
};
const asProductRow = (item: ResolvedProduct) => item as unknown as ProductRow;

/**
 * Decides, row by row, what an import does. Nothing is silently dropped or summed: every row that is left out
 * carries a reason. `resolutions` answers `identifiersToResolve(rows)` position by position.
 */
export function planEntry(rows: readonly EntryRow[], resolutions: readonly Resolution[], context: PlanContext): PlannedRow[] {
  const toResolve = identifiersToResolve(rows);
  if (resolutions.length !== toResolve.length || resolutions.some((item, index) => item.identifier !== toResolve[index])) {
    throw new Error("A resposta da resolução de produtos não corresponde às linhas enviadas.");
  }
  const seen = new Set<number>();
  let cursor = 0;
  return rows.map((row): PlannedRow => {
    if (row.problem !== null) return { row, product: null, candidates: [], skip: row.problem };
    const resolution = resolutions[cursor];
    cursor += 1;
    if (resolution === undefined || resolution.status === "not_found") return { row, product: null, candidates: [], skip: "not_found" };
    if (resolution.status === "ambiguous") {
      return { row, product: null, candidates: (resolution.candidates ?? []).map(asProductRow), skip: "ambiguous" };
    }
    const product = resolution.product === undefined ? null : asProductRow(resolution.product);
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
