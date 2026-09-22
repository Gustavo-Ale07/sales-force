import type { ApiSchema } from "@salesforce/contracts/client";
import { ApiRequestError } from "./api";
import { NO_PREVIOUS_ORDER, TEMPLATE_LIMIT_REACHED, TEMPLATE_NAME_TAKEN, TEMPLATE_NO_USABLE_LINES } from "./api-mutations";
import { describeApiError, type ErrorDescription } from "./error-message";

/**
 * Recurring order templates ("pedidos recorrentes"): product + quantity only. Nothing here knows a price: the
 * server prices the lines when a template is used.
 */

export type SkippedTemplateLine = ApiSchema<"SkippedTemplateLine">;
export type TemplateLineSkipReason = ApiSchema<"TemplateLineSkipReason">;

export const templateSkipReasonLabels: Record<TemplateLineSkipReason, string> = {
  product_removed: "Produto removido do catálogo",
  product_inactive: "Produto inativo",
  no_price: "Produto sem preço para este cliente",
  zero_price: "Produto com preço zero",
  product_hidden: "Produto oculto nesta instalação",
  product_not_sellable: "Produto indisponível para venda",
};

/**
 * Same limits as the contract (`MAX_ORDER_TEMPLATE_NAME_LENGTH` / `MAX_ORDER_TEMPLATE_ITEMS`); the server stays authoritative.
 * Not imported: they are exported only from the contracts main entry, which pulls the Zod schemas into the browser bundle
 * (the `/client` entry carries types and the API client only).
 */
export const MAX_TEMPLATE_NAME_LENGTH = 80;
export const MAX_TEMPLATE_ITEMS = 500;

export interface TemplateErrorDescription extends ErrorDescription {
  /** Discriminator of the conflict, when the failure is one the UI treats specially. */
  reason?: "name_taken" | "limit_reached" | "no_usable_lines" | "version_conflict" | "no_previous_order";
}

/**
 * User-facing pt-BR text for a failed template or "repetir último pedido" call (the server messages are also
 * user-safe, but these are stable and actionable). Both actions share the same `no_usable_lines` conflict shape
 * because they go through the same line classification; `no_previous_order` is specific to "repetir último pedido".
 */
export function describeTemplateError(
  error: unknown,
  fallbackTitle: string,
  /** `use`: the failure happened when creating an order from a template or from the last order (there is no form to reload). */
  context: "edit" | "use" = "edit",
  /** Which action failed, for the couple of messages that name their source ("modelo" vs. "último pedido"). */
  source: "template" | "repeat-last" = "template",
): TemplateErrorDescription {
  if (error instanceof ApiRequestError && error.status === 409) {
    const correlationId = error.correlationId;
    if (error.reason === NO_PREVIOUS_ORDER) {
      return {
        title: "Nenhum pedido registrado no Sales Force para este cliente ainda",
        description: "Assim que este cliente tiver um pedido não cancelado registrado no Sales Force, ele poderá ser repetido por aqui.",
        correlationId,
        reason: "no_previous_order",
      };
    }
    if (error.reason === TEMPLATE_NAME_TAKEN) {
      return {
        title: "Já existe um modelo com este nome",
        description: "Este cliente já tem um modelo com esse nome (maiúsculas e minúsculas não diferenciam). Escolha outro nome.",
        correlationId,
        reason: "name_taken",
      };
    }
    if (error.reason === TEMPLATE_LIMIT_REACHED) {
      const limit = typeof error.details?.limit === "number" ? ` (${error.details.limit})` : "";
      return {
        title: "Limite de modelos atingido",
        description: `Este cliente já tem o máximo de modelos recorrentes${limit}. Apague um modelo que não usa mais e tente de novo.`,
        correlationId,
        reason: "limit_reached",
      };
    }
    if (error.reason === TEMPLATE_NO_USABLE_LINES) {
      return source === "repeat-last"
        ? {
            title: "Nenhum item do último pedido pode ser pedido agora",
            description:
              "Os produtos do último pedido registrado no Sales Force foram removidos, estão inativos, indisponíveis ou sem preço para este cliente. Nenhum pedido foi criado.",
            correlationId,
            reason: "no_usable_lines",
          }
        : {
            title: "Nenhum item do modelo pode ser pedido agora",
            description:
              "Os produtos do modelo foram removidos, estão inativos, indisponíveis ou sem preço para este cliente. Nenhum pedido foi criado.",
            correlationId,
            reason: "no_usable_lines",
          };
    }
    if (error.code === "version_conflict") {
      return context === "use"
        ? {
            title: "O modelo mudou",
            description: "O modelo foi alterado enquanto o pedido era criado. Nenhum pedido foi criado; tente novamente.",
            correlationId,
            reason: "version_conflict",
          }
        : {
            title: "O modelo foi alterado por outra pessoa",
            description: "O modelo mudou desde que foi aberto.",
            correlationId,
            reason: "version_conflict",
          };
    }
  }
  return describeApiError(error, fallbackTitle);
}

const SKIP_REASONS = new Set<string>(Object.keys(templateSkipReasonLabels));

/** `skippedLines` carried in the `details` of a `no_usable_lines` conflict (validated: unknown shapes are dropped). */
export function skippedLinesOf(error: unknown): SkippedTemplateLine[] {
  const raw = error instanceof ApiRequestError ? error.details?.skippedLines : undefined;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { lineNo, productCode, reason } = entry as Record<string, unknown>;
    if (typeof lineNo !== "number" || typeof productCode !== "number" || typeof reason !== "string" || !SKIP_REASONS.has(reason)) return [];
    return [{ lineNo, productCode, reason: reason as TemplateLineSkipReason }];
  });
}

/**
 * History-state carried from the customer page to a freshly created draft, so the editor can show which lines of
 * the source (a template or the customer's last order) were left out. `source` picks the wording; both actions
 * reuse the same `TemplateSkippedNotice` component.
 */
export interface OrderNoticeState {
  source: "template" | "repeat-last";
  templateName?: string;
  skippedLines?: SkippedTemplateLine[];
}
