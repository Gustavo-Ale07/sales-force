import type { ErpReleaseState } from './erp-release.js';

/**
 * Billing (faturamento) status of an order already included in the ERP. Pure: it maps FACTS read by the integration
 * layer; it knows no Sankhya table. NEEDS VALIDATION in the Sandbox (docs/sankhya-spike.md, billing block).
 *
 * Precedence, first match wins: cancelled > denied > awaiting_release > invoiced > awaiting_billing > sent.
 * `sent` = the note exists and was NOT confirmed (STATUSNOTA 'A') with no pending release: "Enviado (sem confirmação)".
 * A note that fits no state (e.g. confirmed, nothing pending, no sale note) has no billing state (`null`).
 */
export type ErpBillingState = 'cancelled' | 'denied' | 'awaiting_release' | 'invoiced' | 'awaiting_billing' | 'sent';

export const ERP_BILLING_STATES: readonly ErpBillingState[] = ['cancelled', 'denied', 'awaiting_release', 'invoiced', 'awaiting_billing', 'sent'];

export interface ErpBillingFacts {
  /** The note is gone from the ERP order header and was found in the cancellation tables. A missing note alone is NOT a cancellation. */
  readonly cancelled: boolean;
  readonly releaseState: ErpReleaseState | null;
  /** A released sale note (sale movement type, released status) exists with a link to this order. */
  readonly invoiced: boolean;
  /** STATUSNOTA of the order note ('A' not confirmed, 'L' confirmed). */
  readonly statusNota: string | null;
  /** PENDENTE of the order note. */
  readonly pending: string | null;
}

export function billingStateOf(facts: ErpBillingFacts): ErpBillingState | null {
  if (facts.cancelled) return 'cancelled';
  if (facts.releaseState === 'denied') return 'denied';
  if (facts.releaseState === 'awaiting') return 'awaiting_release';
  if (facts.invoiced) return 'invoiced';
  if (facts.statusNota === 'L' && facts.pending === 'S') return 'awaiting_billing';
  if (facts.statusNota === 'A') return 'sent';
  return null;
}

/** Nothing more changes: stop reading (cancelled, or invoiced). */
export function isFinalBillingState(state: ErpBillingState | null): boolean {
  return state === 'cancelled' || state === 'invoiced';
}

export interface BillingItemFacts {
  /** QTDNEG as a decimal string. */
  readonly ordered: string;
  /** QTDENTREGUE as a decimal string. */
  readonly delivered: string;
  /** PENDENTE of the item. */
  readonly pending: string | null;
}

export interface BillingItemQuantities {
  readonly invoiced: string;
  /** QTDNEG − QTDENTREGUE when the item is no longer pending (PENDENTE = 'N'); '0' otherwise. */
  readonly cut: string;
}

const SCALE = 6;

function toUnits(text: string): bigint | null {
  const match = /^(-?)(\d+)(?:[.,](\d+))?$/.exec(text.trim());
  if (match === null) return null;
  const fraction = (match[3] ?? '').slice(0, SCALE).padEnd(SCALE, '0');
  const units = BigInt(match[2] + fraction);
  return match[1] === '-' ? -units : units;
}

function fromUnits(units: bigint): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(SCALE + 1, '0');
  const whole = digits.slice(0, -SCALE);
  const fraction = digits.slice(-SCALE).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction === '' ? '' : `.${fraction}`}`;
}

/** Per item: invoiced = QTDENTREGUE; cut = QTDNEG − QTDENTREGUE when PENDENTE = 'N' (never QTDFAT/QTDCONFERIDA). Exact decimals. */
export function billingItemQuantities(item: BillingItemFacts): BillingItemQuantities {
  const ordered = toUnits(item.ordered);
  const delivered = toUnits(item.delivered);
  if (ordered === null || delivered === null) return { invoiced: '0', cut: '0' };
  const cut = item.pending === 'N' && ordered > delivered ? ordered - delivered : 0n;
  return { invoiced: fromUnits(delivered), cut: fromUnits(cut) };
}
