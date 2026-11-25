import type { ApiSchema } from "@salesforce/contracts/client";
import { ApiRequestError, callApi, type ApiClient } from "./api";
import { searchExact } from "./bulk-entry";
import { describeDataError } from "./errors";
import { lineFromProduct, parseQuantityInput, type EditorLine } from "./order-draft";
import type { ListPriceContext, ProductListItem, ProductRepository } from "./ports";

/**
 * Recurring order templates ("pedidos recorrentes", same function and rules as the site): a saved list of product + quantity
 * for one customer, kept on the server. Product and quantity only: no price is ever stored; the prices come from the device
 * catalog when a template is used and the server revalidates everything when the order is sent. Online only, like the other
 * server-side lists of the app: there is no local queue for templates.
 */

export type OrderTemplate = ApiSchema<"OrderTemplate">;
export type OrderTemplateDetail = ApiSchema<"OrderTemplateDetail">;
export type DatasetIdentity = ApiSchema<"DatasetIdentity">;

/** Same limits as the contract (`MAX_ORDER_TEMPLATE_NAME_LENGTH` / `MAX_ORDER_TEMPLATE_ITEMS`); the server stays authoritative. */
export const MAX_TEMPLATE_NAME_LENGTH = 80;
export const MAX_TEMPLATE_ITEMS = 500;

export interface TemplateItemInput {
  readonly productCode: number;
  /** Decimal string ("2.5"), already validated. */
  readonly quantity: string;
}

export interface CreateTemplateInput {
  readonly clientRequestId: string;
  readonly expectedDataset: DatasetIdentity;
  readonly name: string;
  readonly items: readonly TemplateItemInput[];
}

export interface OrderTemplatesPort {
  list(customerCode: number): Promise<readonly OrderTemplate[]>;
  get(id: string): Promise<OrderTemplateDetail>;
  create(customerCode: number, input: CreateTemplateInput): Promise<OrderTemplateDetail>;
  remove(id: string): Promise<void>;
}

export function createOrderTemplatesPort(api: ApiClient): OrderTemplatesPort {
  return {
    async list(customerCode) {
      return (await callApi(() => api.GET("/customers/{code}/order-templates", { params: { path: { code: customerCode } } }))).items;
    },
    async get(id) {
      return callApi(() => api.GET("/order-templates/{id}", { params: { path: { id } } }));
    },
    async create(customerCode, input) {
      return callApi(() =>
        api.POST("/customers/{code}/order-templates", {
          params: { path: { code: customerCode } },
          body: { clientRequestId: input.clientRequestId, expectedDataset: input.expectedDataset, name: input.name, items: input.items.map((item) => ({ ...item })) },
        }),
      );
    },
    async remove(id) {
      await callApi(() => api.DELETE("/order-templates/{id}", { params: { path: { id } } }));
    },
  };
}

export type TemplateSkipReason = ApiSchema<"TemplateLineSkipReason">;

/** Same wording as the site (`templateSkipReasonLabels`). */
export const templateSkipReasonLabels: Record<TemplateSkipReason, string> = {
  product_removed: "Produto removido do catálogo",
  product_inactive: "Produto inativo",
  no_price: "Produto sem preço para este cliente",
  zero_price: "Produto com preço zero",
  product_hidden: "Produto oculto nesta instalação",
  product_not_sellable: "Produto indisponível para venda",
};

export interface SkippedTemplateLine {
  /** Position (1-based) of the line in the template. */
  readonly lineNo: number;
  readonly productCode: number;
  readonly description: string | null;
  readonly reason: TemplateSkipReason;
}

export interface TemplateLines {
  readonly lines: EditorLine[];
  readonly skipped: SkippedTemplateLine[];
}

const NO_PRICE: ListPriceContext = { state: "none", tableCode: null, versionId: null, noPriceReason: "no_price_row" };

/** A decimal string of the contract ("2.5") as the text the order editor shows ("2,5"). */
export function quantityTextOf(quantity: string): string {
  return quantity.replace(".", ",");
}

/**
 * The lines of a template as order lines, at today's price of the device catalog for this customer. A line whose product is gone,
 * inactive, not sellable or without a usable price is left out and reported, never priced by guess (same reasons as the site).
 * Each product is looked up once, in template order; a template holds each product once.
 */
export async function buildTemplateLines(
  products: ProductRepository,
  customerCode: number,
  items: readonly TemplateItemInput[],
  isPriceOrderable: (state: ListPriceContext["state"]) => boolean,
  keyPrefix = "tpl",
): Promise<TemplateLines> {
  const lines: EditorLine[] = [];
  const skipped: SkippedTemplateLine[] = [];
  for (const [index, item] of items.entries()) {
    const skip = (reason: TemplateSkipReason, description: string | null = null) => skipped.push({ lineNo: index + 1, productCode: item.productCode, description, reason });
    const own = await searchExact(products, String(item.productCode), customerCode, (product) => product.code === item.productCode);
    const found: ProductListItem | undefined =
      own[0] ?? (await searchExact(products, String(item.productCode), undefined, (product) => product.code === item.productCode))[0];
    if (found === undefined) {
      skip("product_removed");
      continue;
    }
    const priced: ProductListItem = own[0] === undefined ? { ...found, listPrice: NO_PRICE } : found;
    if (!priced.active) skip("product_inactive", priced.description);
    else if (!priced.sellable) skip("product_not_sellable", priced.description);
    else if (priced.listPrice.state === "none") skip("no_price", priced.description);
    else if (!isPriceOrderable(priced.listPrice.state)) skip("zero_price", priced.description);
    else lines.push({ ...lineFromProduct(priced, `${keyPrefix}-${index}`), quantityText: quantityTextOf(item.quantity) });
  }
  return { lines, skipped };
}

/** Product and quantity of the form lines, as the contract wants them; `null` when a quantity is not valid. */
export function templateItemsOf(lines: readonly Pick<EditorLine, "productCode" | "quantityText">[]): TemplateItemInput[] | null {
  const items: TemplateItemInput[] = [];
  for (const line of lines) {
    const quantity = parseQuantityInput(line.quantityText);
    if (!quantity.ok) return null;
    items.push({ productCode: line.productCode, quantity: quantity.value });
  }
  return items;
}

export const TEMPLATE_NAME_TAKEN = "template_name_taken";
export const TEMPLATE_LIMIT_REACHED = "template_limit_reached";

export interface TemplateErrorDescription {
  readonly message: string;
  /** Discriminator of the failures the screen treats specially. */
  readonly reason?: "name_taken" | "limit_reached" | "network";
}

/** User-facing pt-BR text of a failed template call (same wording as the site where the site has one). */
export function describeTemplateError(error: unknown): TemplateErrorDescription {
  if (error instanceof ApiRequestError) {
    if (error.isNetwork) return { message: "Sem conexão com o servidor. Nada foi alterado.", reason: "network" };
    if (error.status === 409 && error.reason === TEMPLATE_NAME_TAKEN) {
      return { message: "Já existe um modelo com este nome para este cliente. Escolha outro nome.", reason: "name_taken" };
    }
    if (error.status === 409 && error.reason === TEMPLATE_LIMIT_REACHED) {
      return { message: "Este cliente já tem o máximo de modelos recorrentes. Apague um modelo que não usa mais e tente de novo.", reason: "limit_reached" };
    }
    if (error.status === 409 && error.code === "dataset_mismatch") {
      return { message: "Os dados deste aparelho são de outra base. Sincronize e tente de novo." };
    }
  }
  return { message: describeDataError(error).message };
}

/** A failed attempt whose outcome is unknown (network, 5xx, 429): the same request id is kept for the retry. */
export function isUnknownTemplateOutcome(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) return true;
  return error.status === 0 || error.status === 429 || error.status >= 500;
}
