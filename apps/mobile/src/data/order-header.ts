import { ApiRequestError } from "./api";
import type { OrderEntryConfiguration } from "./ports";

/**
 * Header choices of an order (TOP, negotiation type, carrier) and the "Duplicar como pedido" outcome texts. Pure,
 * pt-BR, no ERP wording. The server stays authoritative for what is eligible (D-A, D-B, D-C).
 */
type SalesConfiguration = OrderEntryConfiguration["sales"];

/** Negotiation types the seller may choose: the ones flagged `sellable: false` are hidden; an unflagged one is sellable. */
export function sellableNegotiationTypes(types: SalesConfiguration["negotiationTypes"]): SalesConfiguration["negotiationTypes"] {
  return types.filter((type) => type.sellable !== false);
}

export interface TopOption {
  readonly code: number;
  readonly label: string;
}

/** "Pedido (TOP 1001)" for the default order TOP, "Cotação (TOP 1000)" for the quotation TOP, "TOP n" otherwise. */
export function topLabel(code: number, tops: SalesConfiguration["orderTops"]): string {
  if (code === tops.quotationTopCode) return `Cotação (TOP ${code})`;
  if (code === tops.defaultTopCode) return `Pedido (TOP ${code})`;
  return `TOP ${code}`;
}

/** The TOPs the seller may pick, default first. Empty when there is nothing to choose (fewer than two eligible TOPs). */
export function topOptions(tops: SalesConfiguration["orderTops"]): TopOption[] {
  if (tops.eligibleTopCodes.length < 2) return [];
  const rank = (code: number) => (code === tops.defaultTopCode ? 0 : code === tops.quotationTopCode ? 1 : 2);
  return [...tops.eligibleTopCodes].sort((a, b) => rank(a) - rank(b) || a - b).map((code) => ({ code, label: topLabel(code, tops) }));
}

/** True when `topCode` is the installation's quotation TOP. */
export function isQuotationTop(topCode: number | null, tops: SalesConfiguration["orderTops"]): boolean {
  return topCode !== null && tops.quotationTopCode !== null && topCode === tops.quotationTopCode;
}

const skipReasonLabels: Record<string, string> = {
  product_removed: "produto removido",
  product_inactive: "produto inativo",
  no_price: "sem preço",
  zero_price: "preço zerado",
  product_hidden: "produto oculto",
  product_not_sellable: "produto indisponível para venda",
};

/** "Produto 12 (sem preço)" for each line the server left out of the new order. */
export function describeSkippedLines(lines: readonly { productCode: number; reason: string }[]): string[] {
  return lines.map((line) => `Produto ${line.productCode} (${skipReasonLabels[line.reason] ?? "não pôde ser copiado"})`);
}

export interface DuplicateFailure {
  readonly title: string;
  readonly message: string;
  readonly skipped: readonly string[];
}

/** User-facing text for a failed "Duplicar como pedido" (409 reasons of D-B, dataset change, network, session). */
export function describeDuplicateFailure(error: unknown): DuplicateFailure {
  const title = "Não foi possível duplicar como pedido";
  if (error instanceof ApiRequestError) {
    if (error.isNetwork) return { title, message: "Sem conexão com o servidor. Conecte-se e tente novamente.", skipped: [] };
    if (error.status === 409) {
      switch (error.reason ?? error.code) {
        case "not_a_quotation":
          return { title, message: "Este pedido não é uma cotação.", skipped: [] };
        case "source_cancelled":
          return { title, message: "A cotação foi cancelada e não pode ser duplicada.", skipped: [] };
        case "order_top_not_configured":
          return { title, message: "A operação de pedido ainda não foi configurada nesta instalação. Fale com o administrador.", skipped: [] };
        case "no_usable_lines":
          return { title, message: "Nenhum item da cotação pode ser pedido agora.", skipped: describeSkippedLines(error.skippedLines) };
        case "dataset_mismatch":
          return { title, message: "Os dados do servidor mudaram. Atualize o aplicativo e tente novamente.", skipped: [] };
      }
    }
    if (error.status === 404) return { title, message: "Esta cotação não está mais disponível.", skipped: [] };
    if (error.status === 403) return { title, message: "Seu perfil não tem permissão para esta operação.", skipped: [] };
  }
  return { title, message: "Tente novamente em instantes.", skipped: [] };
}
