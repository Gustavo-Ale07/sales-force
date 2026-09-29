import type { DraftIssueCode, OrderItemInput } from "@salesforce/contracts";
import {
  buildOrderItem,
  computeDiscountSummary,
  computeLineTotal,
  computeOrderTotals,
  isLineOrderable,
  subtractTotals,
  sumQuantities,
  validateDiscountPercent,
  validateQuantity,
  type DecimalError,
  type OrderDiscountSummary,
  type OrderItem,
  type OrderTotals,
  type ResolvedPrice,
} from "@salesforce/domain";
import type { ListPriceContext, ProductListItem } from "./ports";

/**
 * Mobile-side model of a new order draft, used only while online (MOB-4). Only product, quantity and the
 * discount percentage ever travel to the server; prices are always resolved there (P-09). The preview below
 * calls the SAME domain functions as the server (`buildOrderItem`, `computeOrderTotals`), so it is an estimate
 * from list prices only; the server response on save is authoritative. Mirrors `apps/web/src/lib/order-draft.ts`
 * (each client owns its own UI-state adapter; the commercial math itself lives only in `packages/domain`).
 */

export interface EditorLine {
  /** Stable React key (not sent to the server). */
  readonly key: string;
  readonly productCode: number;
  readonly description: string;
  readonly unit: string;
  /** Quantity as typed (pt-BR, decimal comma). */
  readonly quantityText: string;
  /** Discount percentage as typed (pt-BR, decimal comma); empty = no discount. */
  readonly discountText: string;
  readonly price: ListPriceContext;
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

export const quantityProblemMessages: Record<QuantityProblem, string> = {
  empty: "Informe a quantidade.",
  dot_separator: "Use vírgula como separador decimal.",
  not_a_decimal: "Quantidade inválida.",
  not_positive: "A quantidade deve ser maior que zero.",
  negative: "A quantidade deve ser maior que zero.",
  too_many_decimals: "No máximo 4 casas decimais.",
  out_of_range: "Quantidade acima do limite permitido.",
};

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

/** Adds one unit to a line already in the cart (tapping the same product again in the catalog). An invalid typed quantity is treated as zero before adding, never as a text concatenation. */
export function incrementLineQuantity(line: EditorLine): EditorLine {
  const parsed = parseQuantityInput(line.quantityText);
  const next = sumQuantities([parsed.ok ? parsed.value : "0", "1"]);
  return { ...line, quantityText: next.replace(".", ",") };
}

export function lineFromProduct(product: ProductListItem, key: string): EditorLine {
  return {
    key,
    productCode: product.code,
    description: product.description,
    unit: product.unit,
    quantityText: "1",
    discountText: "",
    price: product.listPrice,
  };
}

/** Missing or inconsistent price data is treated as "no price", never as a fabricated value. */
function resolvedPriceOf(price: ListPriceContext): ResolvedPrice {
  if (price.state === "none") return { state: "none", reason: price.noPriceReason, tableCode: price.tableCode, versionId: price.versionId };
  return { state: price.state, unitPrice: price.unitPrice, tableCode: price.tableCode, versionId: price.versionId };
}

export interface LinePreview {
  readonly key: string;
  /** Item built by the domain; `null` while the quantity or discount is invalid. */
  readonly item: OrderItem | null;
  readonly quantityProblem?: QuantityProblem;
  readonly discountProblem?: DiscountProblem;
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
  readonly lines: readonly LinePreview[];
  readonly totals: OrderTotals;
  /** Total before discount and what the discounts take off. */
  readonly discounts: OrderDiscountSummary;
  /** Every line has a valid quantity and discount (required before saving). */
  readonly valid: boolean;
}

export function previewDraft(lines: readonly EditorLine[]): DraftPreview {
  const previews = lines.map((line, index) => previewLine(line, index + 1));
  const items = previews.flatMap((p) => (p.item ? [p.item] : []));
  return {
    lines: previews,
    totals: computeOrderTotals(items),
    discounts: computeDiscountSummary(items),
    valid: previews.every((p) => p.item !== null),
  };
}

/** Per-line display amounts: the list subtotal, the amount the discount takes off, and the final line total. Domain math only. */
export interface LineAmounts {
  readonly subtotal: string | null;
  readonly discountAmount: string | null;
  readonly lineTotal: string | null;
}

export function lineAmountsOf(preview: LinePreview): LineAmounts {
  const item = preview.item;
  if (!item || item.unitListPrice === null || item.estimatedLineTotal === null) {
    return { subtotal: null, discountAmount: null, lineTotal: null };
  }
  const subtotal = computeLineTotal(item.quantity, item.unitListPrice);
  return { subtotal, discountAmount: subtractTotals(subtotal, item.estimatedLineTotal), lineTotal: item.estimatedLineTotal };
}

/** Body items of `POST /orders`: product, quantity and, when there is one, the discount percentage. */
export function toRequestItems(lines: readonly EditorLine[]): OrderItemInput[] {
  return lines.flatMap((line) => {
    const quantity = parseQuantityInput(line.quantityText);
    if (!quantity.ok) return [];
    const discount = parseDiscountInput(line.discountText);
    const hasDiscount = discount.ok && discount.value !== "0" && line.price.state !== "none";
    return [{ productCode: line.productCode, quantity: quantity.value, ...(hasDiscount ? { discountPercent: discount.value } : {}) }];
  });
}

/**
 * Whether a line in this price state may be drafted under the installation configuration. Uses the domain rule
 * (`isLineOrderable`) with the two settings the order-entry configuration exposes; the server result is authoritative.
 */
export function isLinePriceOrderable(
  state: ListPriceContext["state"],
  config: { sales: { orderBehavior: { allowDraftWithoutPrice: boolean } }; products: { productWithoutPrice: { orderable: boolean } } },
): boolean {
  return isLineOrderable(state, config as Parameters<typeof isLineOrderable>[1]);
}

const issueMessages: Record<DraftIssueCode, string> = {
  installation_not_enabled: "A instalação ainda não está habilitada para pedidos.",
  status_not_editable: "Este pedido não pode mais ser editado.",
  invalid_line_number: "Numeração de itens inválida.",
  duplicate_line_number: "Numeração de itens duplicada.",
  invalid_quantity: "Quantidade inválida.",
  invalid_discount: "Desconto inválido.",
  price_state_inconsistent: "Preço inconsistente. Recarregue e tente novamente.",
  price_reference_missing: "Preço sem tabela de referência. Recarregue e tente novamente.",
  line_total_mismatch: "Total do item divergente do calculado. Recarregue e tente novamente.",
  line_not_orderable: "Este item não pode ser pedido sem preço nesta instalação.",
  product_unknown: "Produto não encontrado.",
  product_not_sellable: "Produto indisponível para venda.",
  negotiation_type_not_configured: "Tipo de negociação não configurado nesta instalação.",
  order_total_mismatch: "Total do pedido divergente do calculado. Recarregue e tente novamente.",
  order_total_out_of_range: "O total do pedido excede o limite permitido.",
};

const ITEM_PATH = /^items\[(\d+)\]/;

/** "items[2]" + code -> "Item 3: ...". Unknown codes fall back to the (user-safe) server message. */
export function describeIssue(issue: { path: string; code: string; message?: string }): string {
  const text = (issueMessages as Record<string, string | undefined>)[issue.code] ?? issue.message ?? "Dado inválido.";
  const match = ITEM_PATH.exec(issue.path);
  return match ? `Item ${Number(match[1]) + 1}: ${text}` : text;
}

export interface CartSummary {
  /** Lines in the cart, valid or not. */
  readonly lineCount: number;
  /** Sum of the valid quantities per unit; units are never mixed into one number. */
  readonly quantities: readonly { unit: string; quantity: string }[];
  /** Lines whose quantity is still invalid (and so left out of the quantities and the total). */
  readonly invalidLineCount: number;
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
