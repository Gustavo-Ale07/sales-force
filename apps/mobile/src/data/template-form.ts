import { decrementLineQuantity, incrementLineQuantity, lineFromProduct, parseQuantityInput, quantityProblemMessages, type EditorLine } from "./order-draft";
import { MAX_TEMPLATE_ITEMS, MAX_TEMPLATE_NAME_LENGTH } from "./order-templates";
import type { ProductListItem } from "./ports";

/** Pure list operations of the "Novo pedido recorrente" form: the same product/quantity moves as the order catalog. */

export function addProductLine(lines: readonly EditorLine[], product: ProductListItem, key: string): EditorLine[] {
  const existing = lines.find((line) => line.productCode === product.code);
  if (existing !== undefined) return lines.map((line) => (line.key === existing.key ? incrementLineQuantity(line) : line));
  if (lines.length >= MAX_TEMPLATE_ITEMS) return [...lines];
  return [...lines, lineFromProduct(product, key)];
}

export function decrementProductLine(lines: readonly EditorLine[], product: ProductListItem): EditorLine[] {
  const existing = lines.find((line) => line.productCode === product.code);
  if (existing === undefined) return [...lines];
  const step = decrementLineQuantity(existing);
  if (step === null) return [...lines];
  if (step.kind === "remove") return lines.filter((line) => line.key !== existing.key);
  return lines.map((line) => (line.key === existing.key ? { ...line, quantityText: step.quantityText } : line));
}

export function setProductLineQuantity(
  lines: readonly EditorLine[],
  product: Pick<ProductListItem, "code">,
  result: { kind: "set"; quantityText: string } | { kind: "remove" },
): EditorLine[] {
  const existing = lines.find((line) => line.productCode === product.code);
  if (existing === undefined) return [...lines];
  if (result.kind === "remove") return lines.filter((line) => line.key !== existing.key);
  return lines.map((line) => (line.key === existing.key ? { ...line, quantityText: result.quantityText } : line));
}

/** Lines that arrive from "Lançamento múltiplo": a product already in the list is never added twice or summed. */
export function mergeNewLines(lines: readonly EditorLine[], added: readonly EditorLine[]): EditorLine[] {
  const known = new Set(lines.map((line) => line.productCode));
  const fresh = added.filter((line) => !known.has(line.productCode));
  return [...lines, ...fresh].slice(0, MAX_TEMPLATE_ITEMS);
}

export interface TemplateFormProblems {
  readonly name: string | null;
  readonly lines: string | null;
  /** Message by line key, for a quantity that is not valid. */
  readonly quantities: Readonly<Record<string, string>>;
}

export function templateFormProblems(name: string, lines: readonly EditorLine[]): TemplateFormProblems {
  const trimmed = name.trim();
  const quantities: Record<string, string> = {};
  for (const line of lines) {
    const parsed = parseQuantityInput(line.quantityText);
    if (!parsed.ok) quantities[line.key] = quantityProblemMessages[parsed.problem];
  }
  return {
    name: trimmed === "" ? "Informe o nome do modelo." : trimmed.length > MAX_TEMPLATE_NAME_LENGTH ? `No máximo ${MAX_TEMPLATE_NAME_LENGTH} caracteres.` : null,
    lines: lines.length === 0 ? "Adicione ao menos um produto." : null,
    quantities,
  };
}

export const hasTemplateFormProblems = (problems: TemplateFormProblems): boolean =>
  problems.name !== null || problems.lines !== null || Object.keys(problems.quantities).length > 0;
