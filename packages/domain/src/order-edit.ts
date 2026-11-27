/**
 * Edit = delete and recreate (owner ruling 2026-11-27, spike §9.67/F-51). A Force order may be edited only while its Sankhya
 * note is still unconfirmed and untouched: no confirmation, no invoice, no load, no release line, no definitive financial
 * record. Pure and fail-closed: any fact that cannot be read as "untouched" refuses the edit.
 */

export interface OrderEditFacts {
  /** `null` = the order has no note in Sankhya (refused / never delivered): editing is only re-sending, nothing is deleted. */
  readonly nunota: number | null;
  /** Confirmation status of the note ('A' = unconfirmed, 'L' = confirmed). */
  readonly statusnota: string | null;
  readonly ordemcarga: number | null;
  /** Any release line (TSILIB) exists for the note. */
  readonly hasReleaseLines: boolean;
  /** The note is linked to a sale note (invoicing link). */
  readonly hasInvoiceLink: boolean;
  /** A financial record that is not the provisional title of an unconfirmed order (definitive or settled). */
  readonly hasDefinitiveFinancial: boolean;
}

export type OrderEditRefusal = 'confirmed' | 'invoiced' | 'in_load' | 'has_release' | 'financial_generated' | 'unknown_status';

export type OrderEditVerdict =
  | { readonly canEdit: true; readonly mode: 'resend' | 'delete_and_recreate' }
  | { readonly canEdit: false; readonly reason: OrderEditRefusal };

export function evaluateOrderEdit(facts: OrderEditFacts): OrderEditVerdict {
  if (facts.nunota === null) return { canEdit: true, mode: 'resend' };
  if (facts.hasInvoiceLink) return { canEdit: false, reason: 'invoiced' };
  if ((facts.ordemcarga ?? 0) > 0) return { canEdit: false, reason: 'in_load' };
  if (facts.statusnota === 'L') return { canEdit: false, reason: 'confirmed' };
  if (facts.statusnota !== 'A') return { canEdit: false, reason: 'unknown_status' };
  if (facts.hasReleaseLines) return { canEdit: false, reason: 'has_release' };
  if (facts.hasDefinitiveFinancial) return { canEdit: false, reason: 'financial_generated' };
  return { canEdit: true, mode: 'delete_and_recreate' };
}

export function canEditOrder(facts: OrderEditFacts): boolean {
  return evaluateOrderEdit(facts).canEdit;
}

/**
 * Cheap, mirror-based hint for the `canEdit` flag in lists and details (never the authority: the worker revalidates live
 * before deleting). Only the stage mirror is known, so only the stages that prove "untouched" qualify.
 */
export function canEditFromStage(stage: { readonly code: string } | null, hasNunota: boolean, status: string): boolean {
  if (!hasNunota) return status === 'rejected';
  return stage?.code === 'received';
}
