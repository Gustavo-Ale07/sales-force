/**
 * Status models and transition tables. Pure data + lookups.
 * Reachable: draft edits, the discount approval flow (awaiting_approval / approved / approval_rejected),
 * cancellation and the ERP delivery states (SNK-7). The model only says what is legal; the server performs the ERP
 * transitions solely when its delivery switches are on (SNK-4/SNK-5/SNK-6 gates).
 */

export type OrderStatus =
  | 'draft'
  | 'awaiting_approval'
  | 'approved'
  | 'approval_rejected'
  | 'cancelled'
  | 'queued'
  | 'sent'
  | 'rejected'
  | 'unknown';
export const ORDER_STATUSES: readonly OrderStatus[] = [
  'draft',
  'awaiting_approval',
  'approved',
  'approval_rejected',
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


export const ORDER_TRANSITIONS: readonly StatusTransition<OrderStatus>[] = [
  { from: 'draft', to: 'draft', reachable: true, note: 'draft edit' },
  { from: 'draft', to: 'cancelled', reachable: true, note: 'discard' },
  // Discount approval (DISC-2..6, ORD-1, ORD-2). `rejected` stays the ERP rejection; a reprovação is `approval_rejected`.
  { from: 'draft', to: 'awaiting_approval', reachable: true, note: 'submitted above the owner authority' },
  { from: 'awaiting_approval', to: 'approved', reachable: true, note: 'explicit approval by the level pool' },
  { from: 'awaiting_approval', to: 'approval_rejected', reachable: true, note: 'explicit reprovação, comment mandatory' },
  { from: 'awaiting_approval', to: 'draft', reachable: true, note: 'edit invalidates the pending approval (ORD-1)' },
  { from: 'approval_rejected', to: 'draft', reachable: true, note: 'edit of a reprovado order (ORD-1)' },
  { from: 'awaiting_approval', to: 'cancelled', reachable: true, note: 'discard' },
  { from: 'approval_rejected', to: 'cancelled', reachable: true, note: 'discard' },
  { from: 'approved', to: 'cancelled', reachable: true, note: 'discard before any ERP submission' },
  // ERP delivery (SNK-7). Reachable in the model; the server only performs them when the delivery switches are on.
  { from: 'approved', to: 'queued', reachable: true, note: 'enqueued for the ERP (outbox row in the same transaction)' },
  { from: 'draft', to: 'queued', reachable: true, note: 'enqueued for the ERP (outbox row in the same transaction)' },
  { from: 'queued', to: 'cancelled', reachable: true, note: 'cancel while the outbox row is still pending (D-5)' },
  { from: 'queued', to: 'sent', reachable: true, note: 'included (and confirmed) in the ERP; erp_number stored' },
  { from: 'queued', to: 'rejected', reachable: true, note: 'integration error: permanent refusal or attempts exhausted (D-2)' },
  { from: 'queued', to: 'unknown', reachable: true, note: 'ambiguous result (sent without answer) or included but not yet confirmed (D-4)' },
  { from: 'unknown', to: 'sent', reachable: true, note: 'reconciliation by origin id found the order / confirmation done' },
  { from: 'unknown', to: 'rejected', reachable: true, note: 'verification proved the order was not created and the failure is final' },
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

/**
 * Editable as draft, as rejected-by-approver and while awaiting approval (ORD-1). Never once approved or on any
 * ERP-side state. An edit of the last two returns the order to draft (`statusAfterEdit`).
 */
export function isOrderEditable(status: OrderStatus): boolean {
  return status === 'draft' || status === 'approval_rejected' || status === 'awaiting_approval';
}

/** Status after a successful edit: always draft (the pending approval, if any, is invalidated by the caller). */
export function statusAfterEdit(status: OrderStatus): 'draft' {
  if (!isOrderEditable(status)) throw new Error(`order in status ${status} is not editable`);
  return 'draft';
}

export function reachableOrderTargets(from: OrderStatus): readonly OrderStatus[] {
  return ORDER_TRANSITIONS.filter((t) => t.from === from && t.reachable).map((t) => t.to);
}
