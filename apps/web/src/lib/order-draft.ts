import type { DraftIssueCode } from "@salesforce/contracts";
import type { ApiSchema } from "@salesforce/contracts/client";
import {
  buildOrderItem,
  computeDiscountSummary,
  computeOrderTotals,
  isLineOrderable,
  sumQuantities,
  validateDiscountPercent,
  validateQuantity,
  type DecimalError,
  type OrderDiscountSummary,
  type OrderItem,
  type OrderTotals,
  type ResolvedPrice,
} from "@salesforce/domain";
import type { ListPrice, ProductRow } from "./price-types";

/**
 * Editor-side model of an order draft. Only product, quantity and the discount percentage travel to the server; prices are always resolved
 * there (P-09). The preview below uses the SAME domain functions as the server (buildOrderItem, computeOrderTotals),
 * so it is an estimate from list prices only; the server response is authoritative.
 */

export interface LinePrice {
  state: "priced" | "zero" | "none";
  unitPrice: string | null;
  tableCode: number | null;
  versionId: number | null;
  reason?: ApiSchema<"NoPriceReason">;
}

export interface EditorLine {
  /** Stable React key (not sent to the server). */
  key: string;
  productCode: number;
  description: string;
  unit: string;
  /** Quantity as typed (pt-BR, decimal comma). */
  quantityText: string;
  /** Discount percentage as typed (pt-BR, decimal comma); empty = no discount. */
  discountText: string;
  price: LinePrice;
  /** Product group, for the group discount. `undefined` = not known yet (a line loaded from a saved order); `code: null` = the product has no group. */
  group?: { code: number | null; name: string | null };
}

export type QuantityProblem = "empty" | DecimalError | "dot_separator";

export type QuantityParse = { ok: true; value: string } | { ok: false; problem: QuantityProblem };

/** A pt-BR quantity ("2,5") becomes a decimal string ("2.5") validated by the domain (positive, at most 4 decimals). */
export function parseQuantityInput(text: string): QuantityParse {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, problem: "empty" };
  if (trimmed.includes(".")) return { ok: false, problem: "dot_separator" };
  const result = validateQuantity(trimmed.replace(",", "."));
  return result.ok ? { ok: true, value: result.value } : { ok: false, problem: result.error };
}

export type DiscountProblem = "dot_separator" | DecimalError;

export type DiscountParse = { ok: true; value: string } | { ok: false; problem: DiscountProblem };

/** A pt-BR discount ("12,5", optionally with a trailing %) becomes a decimal string validated by the domain (0 to 99.99, at most 2 decimals). Empty means no discount. */
export function parseDiscountInput(text: string): DiscountParse {
  const trimmed = text.trim().replace(/\s*%$/, "");
  if (trimmed === "") return { ok: true, value: "0" };
  if (trimmed.includes(".")) return { ok: false, problem: "dot_separator" };
  const result = validateDiscountPercent(trimmed.replace(",", "."));
  return result.ok ? { ok: true, value: result.value } : { ok: false, problem: result.error };
}

export const discountProblemMessages: Record<DiscountProblem, string> = {
  dot_separator: "Use vírgula como separador decimal.",
  not_a_decimal: "Desconto inválido.",
  not_positive: "Desconto inválido.",
  negative: "O desconto não pode ser negativo.",
  too_many_decimals: "No máximo 2 casas decimais.",
  out_of_range: "O desconto deve ser menor que 100%.",
};

/** Editor text of a stored percentage: "0" is shown as an empty field, "12.5" as "12,5". */
export function discountTextOf(percent: string): string {
  return percent === "0" ? "" : percent.replace(".", ",");
}

export const quantityProblemMessages: Record<QuantityProblem, string> = {
  empty: "Informe a quantidade.",
  dot_separator: "Use vírgula como separador decimal.",
  not_a_decimal: "Quantidade inválida.",
  not_positive: "A quantidade deve ser maior que zero.",
  negative: "A quantidade deve ser maior que zero.",
  too_many_decimals: "No máximo 4 casas decimais.",
  out_of_range: "Quantidade acima do limite permitido.",
};

export function priceFromListPrice(price: ListPrice): LinePrice {
  if (price.state === "none") {
    return { state: "none", unitPrice: null, tableCode: price.tableCode, versionId: price.versionId, reason: price.noPriceReason };
  }
  return { state: price.state, unitPrice: price.unitPrice, tableCode: price.tableCode, versionId: price.versionId };
}

export function lineFromProduct(product: ProductRow, key: string): EditorLine {
  return {
    key,
    productCode: product.code,
    description: product.description,
    unit: product.unit,
    quantityText: "1",
    discountText: "",
    price: priceFromListPrice(product.listPrice),
    group: { code: product.groupCode, name: product.groupName },
  };
}

export function lineFromOrderItem(item: ApiSchema<"OrderItem">, key: string): EditorLine {
  return {
    key,
    productCode: item.productCode,
    description: item.productDescription,
    unit: item.unit,
    quantityText: item.quantity.replace(".", ","),
    discountText: discountTextOf(item.discountPercent),
    price: {
      state: item.priceState,
      unitPrice: item.unitListPrice,
      tableCode: item.priceTableCode,
      versionId: item.priceVersionId,
    },
  };
}

/** Display form of a line price. Inconsistent data (a price state without a value) is shown as "no price", never as a value. */
export function listPriceOfLine(price: LinePrice): ListPrice {
  if (price.state !== "none" && price.unitPrice !== null && price.tableCode !== null && price.versionId !== null) {
    return { state: price.state, unitPrice: price.unitPrice, tableCode: price.tableCode, versionId: price.versionId };
  }
  return { state: "none", tableCode: price.tableCode, versionId: price.versionId, noPriceReason: price.reason ?? "no_price_row" };
}

/** Missing or inconsistent price data is treated as "no price", never as a fabricated value. */
function resolvedPriceOf(price: LinePrice): ResolvedPrice {
  if (price.state !== "none" && price.unitPrice !== null && price.tableCode !== null && price.versionId !== null) {
    return { state: price.state, unitPrice: price.unitPrice, tableCode: price.tableCode, versionId: price.versionId };
  }
  return { state: "none", reason: price.reason ?? "no_price_row", tableCode: price.tableCode, versionId: price.versionId };
}

export interface LinePreview {
  key: string;
  /** Item built by the domain; `null` while the quantity is invalid. */
  item: OrderItem | null;
  quantityProblem?: QuantityProblem;
  discountProblem?: DiscountProblem;
}

export function previewLine(line: EditorLine, lineNo: number): LinePreview {
  const quantity = parseQuantityInput(line.quantityText);
  const discount = parseDiscountInput(line.discountText);
  if (!quantity.ok || !discount.ok) {
    return {
      key: line.key,
      item: null,
      ...(quantity.ok ? {} : { quantityProblem: quantity.problem }),
      ...(discount.ok ? {} : { discountProblem: discount.problem }),
    };
  }
  const price = resolvedPriceOf(line.price);
  const built = buildOrderItem({
    lineNo,
    product: { code: line.productCode, description: line.description, unit: line.unit },
    quantity: quantity.value,
    price,
    // A missing price has nothing to discount (P-09): the line keeps no discount.
    discountPercent: price.state === "none" ? "0" : discount.value,
  });
  if (!built.ok) return { key: line.key, item: null, quantityProblem: built.error };
  return { key: line.key, item: built.value };
}

export interface DraftPreview {
  lines: LinePreview[];
  totals: OrderTotals;
  /** Total before discount and what the discounts take off. */
  discounts: OrderDiscountSummary;
  /** Every line has a valid quantity (required before saving). */
  valid: boolean;
}

export function previewDraft(lines: readonly EditorLine[]): DraftPreview {
  const previews = lines.map((line, index) => previewLine(line, index + 1));
  const items = previews.flatMap((p) => (p.item ? [p.item] : []));
  return { lines: previews, totals: computeOrderTotals(items), discounts: computeDiscountSummary(items), valid: previews.every((p) => p.item !== null) };
}

/** Body items of `POST/PUT /orders`: product, quantity and, when there is one, the discount percentage. */
export function toRequestItems(lines: readonly EditorLine[]): { productCode: number; quantity: string; discountPercent?: string }[] {
  return lines.flatMap((line) => {
    const quantity = parseQuantityInput(line.quantityText);
    if (!quantity.ok) return [];
    const discount = parseDiscountInput(line.discountText);
    const hasDiscount = discount.ok && discount.value !== "0" && line.price.state !== "none";
    return [{ productCode: line.productCode, quantity: quantity.value, ...(hasDiscount ? { discountPercent: discount.value } : {}) }];
  });
}

/**
 * Sets the discount text of the lines that `match` and that have a price to discount (a missing price is never
 * discounted, P-09). Returns the new lines and how many were changed. The percentage is validated by the caller.
 */
export function applyDiscount(
  lines: readonly EditorLine[],
  discountText: string,
  match: (line: EditorLine) => boolean,
): { lines: EditorLine[]; applied: number } {
  let applied = 0;
  const next = lines.map((line) => {
    if (!match(line) || line.price.state === "none") return line;
    applied += 1;
    return { ...line, discountText };
  });
  return { lines: next, applied };
}

const issueMessages: Record<DraftIssueCode, string> = {
  installation_not_enabled: "A instalação ainda não está habilitada para pedidos.",
  status_not_editable: "Este pedido não pode mais ser editado.",
  invalid_line_number: "Numeração de itens inválida.",
  duplicate_line_number: "Numeração de itens duplicada.",
  invalid_quantity: "Quantidade inválida.",
  invalid_discount: "Desconto inválido.",
  price_state_inconsistent: "Preço inconsistente. Recarregue o rascunho e tente novamente.",
  price_reference_missing: "Preço sem tabela de referência. Recarregue o rascunho e tente novamente.",
  line_total_mismatch: "Total do item divergente do calculado. Recarregue o rascunho e tente novamente.",
  line_not_orderable: "Este item não pode ser pedido sem preço nesta instalação.",
  product_unknown: "Produto não encontrado.",
  product_not_sellable: "Produto indisponível para venda.",
  negotiation_type_not_configured: "Tipo de negociação não configurado nesta instalação.",
  order_total_mismatch: "Total do pedido divergente do calculado. Recarregue o rascunho e tente novamente.",
  order_total_out_of_range: "O total do pedido excede o limite permitido.",
};

const ITEM_PATH = /^items\[(\d+)\]/;

/** "items[2]" + code -> "Item 3: ...". Unknown codes fall back to the (user-safe) server message. */
export function describeIssue(issue: { path: string; code: string; message?: string }): string {
  const text = (issueMessages as Record<string, string | undefined>)[issue.code] ?? issue.message ?? "Dado inválido.";
  const match = ITEM_PATH.exec(issue.path);
  return match ? `Item ${Number(match[1]) + 1}: ${text}` : text;
}

/**
 * Whether a line in this price state may be drafted under the installation configuration. Uses the domain rule
 * (`isLineOrderable`) with the two settings the configuration summary exposes; the server result is authoritative.
 */
export function isLinePriceOrderable(
  state: LinePrice["state"],
  config: { sales: { orderBehavior: { allowDraftWithoutPrice: boolean } }; products: { productWithoutPrice: { orderable: boolean } } },
): boolean {
  return isLineOrderable(state, config as Parameters<typeof isLineOrderable>[1]);
}

export interface CartSummary {
  /** Lines in the cart, valid or not. */
  lineCount: number;
  /** Sum of the valid quantities per unit; units are never mixed into one number. */
  quantities: { unit: string; quantity: string }[];
  /** Lines whose quantity is still invalid (and so left out of the quantities and the total). */
  invalidLineCount: number;
}

export function summarizeCart(lines: readonly EditorLine[], previews: readonly LinePreview[]): CartSummary {
  const byUnit = new Map<string, string[]>();
  let invalid = 0;
  lines.forEach((line, index) => {
    const item = previews[index]?.item;
    if (!item) {
      invalid += 1;
      return;
    }
    const list = byUnit.get(line.unit) ?? [];
    list.push(item.quantity);
    byUnit.set(line.unit, list);
  });
  return {
    lineCount: lines.length,
    quantities: [...byUnit.entries()].map(([unit, list]) => ({ unit, quantity: sumQuantities(list) })),
    invalidLineCount: invalid,
  };
}
