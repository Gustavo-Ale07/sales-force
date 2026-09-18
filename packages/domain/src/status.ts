/**
 * Status models and transition tables. Pure data + lookups.
 * Only `draft -> cancelled` and draft edits are reachable today; the rest is declared so the
 * persistence layer can carry the statuses, but no code path may perform those transitions
 * until ERP submission is enabled (SNK-4/SNK-5 gates).
 */

export type OrderStatus = 'draft' | 'cancelled' | 'queued' | 'sent' | 'rejected' | 'unknown';
export const ORDER_STATUSES: readonly OrderStatus[] = [
  'draft',
  'cancelled',
  'queued',
  'sent',
  'rejected',
  'unknown',
];

export interface StatusTransition<S extends string> {
  readonly from: S;
  readonly to: S;
  /** `false` = declared but not yet reachable in the current release. */
  readonly reachable: boolean;
  readonly note?: string;
}

const NOT_YET = 'ERP submission is disabled until its write-safety gates close';

export const ORDER_TRANSITIONS: readonly StatusTransition<OrderStatus>[] = [
  { from: 'draft', to: 'draft', reachable: true, note: 'draft edit' },
  { from: 'draft', to: 'cancelled', reachable: true, note: 'discard' },
  { from: 'draft', to: 'queued', reachable: false, note: NOT_YET },
  { from: 'queued', to: 'sent', reachable: false, note: NOT_YET },
  { from: 'queued', to: 'rejected', reachable: false, note: NOT_YET },
  { from: 'queued', to: 'unknown', reachable: false, note: NOT_YET },
  { from: 'unknown', to: 'sent', reachable: false, note: NOT_YET },
  { from: 'unknown', to: 'rejected', reachable: false, note: NOT_YET },
];

export type OutboxStatus = 'pending' | 'processing' | 'confirmed' | 'rejected' | 'unknown';
export const OUTBOX_STATUSES: readonly OutboxStatus[] = [
  'pending',
  'processing',
  'confirmed',
  'rejected',
  'unknown',
];

export const OUTBOX_TRANSITIONS: readonly StatusTransition<OutboxStatus>[] = [
  { from: 'pending', to: 'processing', reachable: true },
  { from: 'processing', to: 'confirmed', reachable: true },
  { from: 'processing', to: 'rejected', reachable: true },
  {
    from: 'processing',
    to: 'unknown',
    reachable: true,
    note: 'outcome not known: reconcile by origin id before any retry',
  },
  { from: 'processing', to: 'pending', reachable: true, note: 'retry of a temporary failure' },
  { from: 'unknown', to: 'confirmed', reachable: true, note: 'reconciliation found the record' },
  {
    from: 'unknown',
    to: 'rejected',
    reachable: true,
    note: 'reconciliation proved it was not created',
  },
];

function find<S extends string>(
  table: readonly StatusTransition<S>[],
  from: S,
  to: S,
): StatusTransition<S> | undefined {
  return table.find((t) => t.from === from && t.to === to);
}

/** Declared in the table, reachable or not. */
export function isOrderTransitionDeclared(from: OrderStatus, to: OrderStatus): boolean {
  return find(ORDER_TRANSITIONS, from, to) !== undefined;
}

/** Allowed to happen today. */
export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return find(ORDER_TRANSITIONS, from, to)?.reachable === true;
}

export function canTransitionOutbox(from: OutboxStatus, to: OutboxStatus): boolean {
  return find(OUTBOX_TRANSITIONS, from, to)?.reachable === true;
}

/** Only drafts can be edited. */
export function isOrderEditable(status: OrderStatus): boolean {
  return status === 'draft';
}

export function reachableOrderTargets(from: OrderStatus): readonly OrderStatus[] {
  return ORDER_TRANSITIONS.filter((t) => t.from === from && t.reachable).map((t) => t.to);
}
