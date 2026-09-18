import type { InstallationConfiguration } from './configuration.js';
import type { OrderItem, Product, ResolvedPrice } from './entities.js';
import {
  computeLineTotal,
  decimalEquals,
  isDecimalString,
  isTotalInRange,
  isZeroDecimal,
  sumTotals,
  validateQuantity,
  type DecimalError,
  type DecimalString,
} from './money.js';
import { isLineOrderable, isProductSellable } from './pricing.js';
import { err, ok, type Result } from './result.js';
import { isOrderEditable, type OrderStatus } from './status.js';

export interface SalesOrderDraft {
  readonly customerCode: number;
  readonly sellerCode: number | null;
  readonly status: OrderStatus;
  readonly negotiationTypeCode: number | null;
  readonly notes: string | null;
  readonly items: readonly OrderItem[];
  /** Estimate from list prices only; the final value is calculated by the ERP. */
  readonly estimatedTotal: DecimalString;
}

export interface BuildOrderItemInput {
  readonly lineNo: number;
  readonly product: Pick<Product, 'code' | 'description' | 'unit'>;
  /** Raw quantity as a decimal string; validated here. */
  readonly quantity: string;
  /** Price resolved server-side. Client-sent prices are never an input. */
  readonly price: ResolvedPrice;
}

/**
 * Builds a priced order line from a server-resolved price. Missing price stays `null` (never 0);
 * an explicit zero price gives a zero estimate.
 */
export function buildOrderItem(input: BuildOrderItemInput): Result<OrderItem, DecimalError> {
  const quantity = validateQuantity(input.quantity);
  if (!quantity.ok) return err(quantity.error);

  const { price } = input;
  const base = {
    lineNo: input.lineNo,
    productCode: input.product.code,
    productDescription: input.product.description,
    unit: input.product.unit,
    quantity: quantity.value,
  };

  if (price.state === 'none') {
    return ok({
      ...base,
      unitListPrice: null,
      priceState: 'none',
      priceTableCode: price.tableCode,
      priceVersionId: price.versionId,
      estimatedLineTotal: null,
    });
  }
  return ok({
    ...base,
    unitListPrice: price.unitPrice,
    priceState: price.state,
    priceTableCode: price.tableCode,
    priceVersionId: price.versionId,
    estimatedLineTotal: computeLineTotal(quantity.value, price.unitPrice),
  });
}

export interface OrderTotals {
  /** Sum of the line estimates that exist; lines without a price contribute nothing (not zero). */
  readonly estimatedTotal: DecimalString;
  readonly lineCount: number;
  readonly unpricedLineCount: number;
  /** True when at least one line has no price, i.e. the total does not cover the whole order. */
  readonly isPartial: boolean;
}

export function computeOrderTotals(items: readonly OrderItem[]): OrderTotals {
  const totals: DecimalString[] = [];
  let unpriced = 0;
  for (const item of items) {
    if (item.estimatedLineTotal === null) unpriced += 1;
    else totals.push(item.estimatedLineTotal);
  }
  return {
    estimatedTotal: sumTotals(totals),
    lineCount: items.length,
    unpricedLineCount: unpriced,
    isPartial: unpriced > 0,
  };
}

export type DraftIssueCode =
  | 'installation_not_enabled'
  | 'status_not_editable'
  | 'invalid_line_number'
  | 'duplicate_line_number'
  | 'invalid_quantity'
  | 'price_state_inconsistent'
  | 'price_reference_missing'
  | 'line_total_mismatch'
  | 'line_not_orderable'
  | 'product_unknown'
  | 'product_not_sellable'
  | 'negotiation_type_not_configured'
  | 'order_total_mismatch'
  | 'order_total_out_of_range';

export interface DraftIssue {
  readonly code: DraftIssueCode;
  /** Location, e.g. `items[2].quantity`. */
  readonly path: string;
}

export interface ValidateDraftOptions {
  /** When given, each line's product must exist and be sellable per configuration. */
  readonly products?: ReadonlyMap<number, Product>;
}

/** Deterministic invariants of a draft. Empty list = the draft is consistent. */
export function validateDraftInvariants(
  draft: SalesOrderDraft,
  config: InstallationConfiguration,
  options: ValidateDraftOptions = {},
): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const add = (code: DraftIssueCode, path: string): void => {
    issues.push({ code, path });
  };

  if (!config.general.enabled) add('installation_not_enabled', 'config.general.enabled');
  if (!isOrderEditable(draft.status)) add('status_not_editable', 'status');

  if (
    draft.negotiationTypeCode !== null &&
    !config.sales.negotiationTypes.some((t) => t.code === draft.negotiationTypeCode)
  ) {
    add('negotiation_type_not_configured', 'negotiationTypeCode');
  }

  const seenLines = new Set<number>();
  draft.items.forEach((item, index) => {
    const at = `items[${index}]`;

    if (!Number.isInteger(item.lineNo) || item.lineNo < 1) add('invalid_line_number', `${at}.lineNo`);
    else if (seenLines.has(item.lineNo)) add('duplicate_line_number', `${at}.lineNo`);
    seenLines.add(item.lineNo);

    if (!validateQuantity(item.quantity).ok) add('invalid_quantity', `${at}.quantity`);

    checkPriceConsistency(item, at, add);

    if (!isLineOrderable(item.priceState, config)) add('line_not_orderable', `${at}.priceState`);

    if (options.products) {
      const product = options.products.get(item.productCode);
      if (!product) add('product_unknown', `${at}.productCode`);
      else if (!isProductSellable(product, config)) add('product_not_sellable', `${at}.productCode`);
    }
  });

  const structurallySound =
    isDecimalString(draft.estimatedTotal) &&
    draft.items.every(
      (i) => i.estimatedLineTotal === null || isDecimalString(i.estimatedLineTotal),
    );
  if (!structurallySound) {
    add('order_total_mismatch', 'estimatedTotal');
  } else {
    const expected = computeOrderTotals(draft.items).estimatedTotal;
    if (!decimalEquals(expected, draft.estimatedTotal)) add('order_total_mismatch', 'estimatedTotal');
    if (!isTotalInRange(expected)) add('order_total_out_of_range', 'estimatedTotal');
  }
  return issues;
}

function checkPriceConsistency(
  item: OrderItem,
  at: string,
  add: (code: DraftIssueCode, path: string) => void,
): void {
  if (item.priceState === 'none') {
    if (item.unitListPrice !== null || item.estimatedLineTotal !== null) {
      add('price_state_inconsistent', `${at}.priceState`);
    }
    return;
  }

  if (item.unitListPrice === null || !isDecimalString(item.unitListPrice)) {
    add('price_state_inconsistent', `${at}.unitListPrice`);
    return;
  }
  const isZero = isZeroDecimal(item.unitListPrice);
  if ((item.priceState === 'zero') !== isZero) add('price_state_inconsistent', `${at}.priceState`);
  if (item.priceTableCode === null || item.priceVersionId === null) {
    add('price_reference_missing', `${at}.priceVersionId`);
  }

  if (item.estimatedLineTotal === null || !isDecimalString(item.estimatedLineTotal)) {
    add('line_total_mismatch', `${at}.estimatedLineTotal`);
    return;
  }
  if (validateQuantity(item.quantity).ok) {
    const expected = computeLineTotal(item.quantity, item.unitListPrice);
    if (!decimalEquals(expected, item.estimatedLineTotal)) {
      add('line_total_mismatch', `${at}.estimatedLineTotal`);
    }
  }
}
