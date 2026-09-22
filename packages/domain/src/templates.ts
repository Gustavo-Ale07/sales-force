import type { InstallationConfiguration } from './configuration.js';
import type { AccountRole, Product, ResolvedPrice } from './entities.js';
import { validateQuantity, type DecimalString } from './money.js';
import { isLineOrderable, isProductSellable, isProductVisible } from './pricing.js';
import { err, ok, type Result } from './result.js';

/**
 * Recurring order templates ("pedido recorrente"): a saved list of (product, quantity) per customer.
 * A template carries no price, discount or note: using it creates a NEW, independent draft that is
 * priced and validated from scratch against the current catalog. These are the pure rules; who may
 * see or use a template (the customer's seller scope), idempotency and storage stay in the server.
 */

/** Live templates per customer. */
export const MAX_TEMPLATES_PER_CUSTOMER = 50;
/** Lines per template (mirrors the storage check and the order draft limit). */
export const MAX_TEMPLATE_ITEMS = 500;
export const MAX_TEMPLATE_NAME_LENGTH = 80;

/** A product code is a non-negative integer that fits the ERP's integer column. */
const PRODUCT_CODE_MAX = 2_147_483_647;

/* ---------- name ---------- */

export type TemplateNameError = 'name_empty' | 'name_too_long' | 'name_control_characters';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

/** Trimmed name, 1..80 characters (code points, like the database check), no control characters. */
export function normalizeTemplateName(raw: string): Result<string, TemplateNameError> {
  const name = raw.trim();
  if (name === '') return err('name_empty');
  if (CONTROL_CHARACTERS.test(name)) return err('name_control_characters');
  if ([...name].length > MAX_TEMPLATE_NAME_LENGTH) return err('name_too_long');
  return ok(name);
}

/* ---------- items ---------- */

export interface TemplateItemInput {
  readonly productCode: number;
  readonly quantity: string;
}

export interface TemplateItem {
  readonly productCode: number;
  readonly quantity: DecimalString;
}

export type TemplateItemIssueCode =
  | 'no_items'
  | 'too_many_items'
  | 'invalid_product_code'
  | 'duplicate_product'
  | 'invalid_quantity';

export interface TemplateItemIssue {
  readonly code: TemplateItemIssueCode;
  /** Location, e.g. `items[2].quantity`. */
  readonly path: string;
}

/**
 * Validates the requested lines and returns them with canonical quantities (`"2.5000"` -> `"2.5"`),
 * in the order given. A product may appear once: a repeated one is reported, never summed silently.
 */
export function normalizeTemplateItems(
  items: readonly TemplateItemInput[],
): Result<TemplateItem[], TemplateItemIssue[]> {
  if (items.length === 0) return err([{ code: 'no_items', path: 'items' }]);
  if (items.length > MAX_TEMPLATE_ITEMS) return err([{ code: 'too_many_items', path: 'items' }]);

  const issues: TemplateItemIssue[] = [];
  const seen = new Set<number>();
  const normalized: TemplateItem[] = [];
  items.forEach((item, index) => {
    const at = `items[${index}]`;
    if (!Number.isSafeInteger(item.productCode) || item.productCode < 0 || item.productCode > PRODUCT_CODE_MAX) {
      issues.push({ code: 'invalid_product_code', path: `${at}.productCode` });
    } else if (seen.has(item.productCode)) {
      issues.push({ code: 'duplicate_product', path: `${at}.productCode` });
    }
    seen.add(item.productCode);

    const quantity = validateQuantity(item.quantity);
    if (!quantity.ok) issues.push({ code: 'invalid_quantity', path: `${at}.quantity` });
    else normalized.push({ productCode: item.productCode, quantity: quantity.value });
  });
  return issues.length > 0 ? err(issues) : ok(normalized);
}

/* ---------- limit ---------- */

/** Whether a customer with `liveCount` live templates may have one more. */
export function canAddTemplate(liveCount: number): boolean {
  return liveCount < MAX_TEMPLATES_PER_CUSTOMER;
}

/* ---------- using a template ---------- */

export interface TemplateLine {
  readonly lineNo: number;
  readonly productCode: number;
  readonly quantity: DecimalString;
}

export type TemplateLineSkipReason =
  | 'product_removed'
  | 'product_inactive'
  | 'no_price'
  | 'zero_price'
  | 'product_hidden'
  | 'product_not_sellable';

export interface TemplateLineSkip {
  readonly lineNo: number;
  readonly productCode: number;
  readonly reason: TemplateLineSkipReason;
}

/**
 * Splits the lines of a template into those that may be ordered now and those that may not, judged
 * against the CURRENT catalog with the customer's price context (`prices` are already resolved for
 * that customer). The same rules the draft applies: sellable per configuration, and a missing or zero
 * price only when the installation lets such a line be ordered. A skipped line is reported with its
 * reason and never priced by guess: a missing price is not 0.
 */
export function selectUsableTemplateLines(
  lines: readonly TemplateLine[],
  products: ReadonlyMap<number, Product>,
  prices: ReadonlyMap<number, ResolvedPrice>,
  config: InstallationConfiguration,
): { usable: TemplateLine[]; skipped: TemplateLineSkip[] } {
  const usable: TemplateLine[] = [];
  const skipped: TemplateLineSkip[] = [];
  const skip = (line: TemplateLine, reason: TemplateLineSkipReason): void => {
    skipped.push({ lineNo: line.lineNo, productCode: line.productCode, reason });
  };

  for (const line of lines) {
    const product = products.get(line.productCode);
    if (product === undefined) {
      skip(line, 'product_removed');
      continue;
    }
    if (!product.active) {
      skip(line, 'product_inactive');
      continue;
    }
    const price = prices.get(line.productCode);
    const state = price?.state ?? 'none';
    if (!isLineOrderable(state, config)) {
      skip(line, state === 'zero' ? 'zero_price' : 'no_price');
      continue;
    }
    if (!isProductVisible(product, config, state)) {
      skip(line, 'product_hidden');
      continue;
    }
    if (!isProductSellable(product, config)) {
      skip(line, 'product_not_sellable');
      continue;
    }
    usable.push(line);
  }
  return { usable, skipped };
}

/**
 * Hidden and not-sellable products look like removed ones to everyone but the admin, so a caller
 * (order creation, "repetir último pedido", template use) cannot use skipped lines to probe which
 * product codes exist behind the catalog visibility rules (P-21).
 */
export function presentSkips(role: AccountRole, skipped: readonly TemplateLineSkip[]): TemplateLineSkip[] {
  return skipped.map((line) =>
    role !== 'admin' && (line.reason === 'product_hidden' || line.reason === 'product_not_sellable')
      ? { ...line, reason: 'product_removed' as const }
      : { ...line },
  );
}
