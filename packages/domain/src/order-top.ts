import type { InstallationConfiguration, NegotiationType } from './configuration.js';

type SalesConfiguration = InstallationConfiguration['sales'];

/**
 * Order TOP (D-A, D-B). The TOPs an order may carry: the installation's explicit list, or, when it has none,
 * the order and quotation TOPs it configures. Pure; the values come only from configuration.
 */
export function eligibleOrderTopCodesOf(sales: SalesConfiguration): readonly number[] {
  if (sales.eligibleOrderTopCodes !== undefined) return sales.eligibleOrderTopCodes;
  return [sales.orderTopCode, sales.quotationTopCode].filter((code): code is number => code !== null);
}

export type OrderTopResolution =
  | { readonly ok: true; readonly value: number | null }
  | { readonly ok: false; readonly code: 'order_top_not_eligible' };

/** The TOP an order is stored with: the requested one when eligible, the configured default when none is requested. */
export function resolveOrderTopCode(requested: number | null | undefined, sales: SalesConfiguration): OrderTopResolution {
  const value = requested ?? sales.orderTopCode;
  if (value === null) return { ok: true, value: null };
  return eligibleOrderTopCodesOf(sales).includes(value) ? { ok: true, value } : { ok: false, code: 'order_top_not_eligible' };
}

/** A quotation is an order carrying the quotation TOP (no separate state machine). */
export function isQuotationTopCode(topCode: number | null, sales: SalesConfiguration): boolean {
  return topCode !== null && sales.quotationTopCode !== null && topCode === sales.quotationTopCode;
}

/** Negotiation types a draft can use and an API list can show (D-B). */
export function sellableNegotiationTypes(sales: SalesConfiguration): readonly NegotiationType[] {
  return sales.negotiationTypes.filter((type) => type.sellable !== false);
}
