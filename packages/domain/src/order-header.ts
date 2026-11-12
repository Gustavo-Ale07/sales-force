/**
 * Mandatory order header (owner ruling 2026-11-12): TOP, negotiation type, freight and carrier must be chosen to
 * advance / to send the order; only the notes are optional. Pure and deterministic: site, app and server use this one
 * rule. A draft may be SAVED incomplete (old drafts open and ask to complete); sending requires an empty issue list.
 *
 * The carrier is a deliberate choice: "no carrier" is not an absent value. If the ERP has a carrier that means "none",
 * it is an ordinary carrier code the seller picks on purpose.
 */
export type OrderHeaderIssueCode = 'missing_top' | 'missing_negotiation_type' | 'missing_freight_type' | 'missing_carrier';

export interface OrderHeaderInput {
  /** The TOP in force: the chosen one, or the installation default when none was chosen. */
  readonly topCode: number | null | undefined;
  readonly negotiationTypeCode: number | null | undefined;
  readonly freightType: string | null | undefined;
  readonly carrierCode: number | null | undefined;
}

const isChosenCode = (code: number | null | undefined): boolean => typeof code === 'number' && Number.isSafeInteger(code) && code >= 0;

/** Missing header fields in screen order (TOP, negotiation, freight, carrier). Empty = complete. */
export function orderHeaderIssues(input: OrderHeaderInput): readonly OrderHeaderIssueCode[] {
  const issues: OrderHeaderIssueCode[] = [];
  if (!isChosenCode(input.topCode)) issues.push('missing_top');
  if (!isChosenCode(input.negotiationTypeCode)) issues.push('missing_negotiation_type');
  if (input.freightType !== 'CIF' && input.freightType !== 'FOB' && input.freightType !== 'SEM_FRETE') issues.push('missing_freight_type');
  if (!isChosenCode(input.carrierCode)) issues.push('missing_carrier');
  return issues;
}

/** Seller-facing label of each missing field (pt-BR), the same on the site and in the app. */
export const ORDER_HEADER_ISSUE_LABEL: Record<OrderHeaderIssueCode, string> = {
  missing_top: 'Tipo de operação',
  missing_negotiation_type: 'Tipo de negociação',
  missing_freight_type: 'Frete',
  missing_carrier: 'Transportadora',
};
