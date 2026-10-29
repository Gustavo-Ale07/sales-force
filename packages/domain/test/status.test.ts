import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  OUTBOX_STATUSES,
  canTransitionOrder,
  canTransitionOutbox,
  isOrderEditable,
  isOrderTransitionDeclared,
  reachableOrderTargets,
  statusAfterEdit,
  type OrderStatus,
  type OutboxStatus,
} from '../src/index.js';

describe('order status transitions', () => {
  it('declares every status', () => {
    expect(ORDER_STATUSES).toHaveLength(9);
  });

  it('only the approval flow, edits and cancellation are reachable today (no ERP state)', () => {
    const reachable = ORDER_TRANSITIONS.filter((t) => t.reachable).map((t) => `${t.from}->${t.to}`);
    expect(reachable.sort()).toEqual(
      [
        'approval_rejected->cancelled',
        'approval_rejected->draft',
        'approved->cancelled',
        'awaiting_approval->approval_rejected',
        'awaiting_approval->approved',
        'awaiting_approval->cancelled',
        'awaiting_approval->draft',
        'draft->awaiting_approval',
        'draft->cancelled',
        'draft->draft',
      ].sort(),
    );
  });

  it.each([
    ['draft', 'draft', true],
    ['draft', 'cancelled', true],
    ['draft', 'queued', false],
    ['queued', 'sent', false],
    ['queued', 'rejected', false],
    ['queued', 'unknown', false],
    ['unknown', 'sent', false],
    ['cancelled', 'draft', false],
    ['cancelled', 'cancelled', false],
    ['sent', 'draft', false],
    ['rejected', 'queued', false],
  ] as [OrderStatus, OrderStatus, boolean][])('canTransitionOrder %s -> %s = %s', (from, to, expected) => {
    expect(canTransitionOrder(from, to)).toBe(expected);
  });

  it('distinguishes declared-but-unreachable from undeclared', () => {
    expect(isOrderTransitionDeclared('draft', 'queued')).toBe(true);
    expect(canTransitionOrder('draft', 'queued')).toBe(false);
    expect(isOrderTransitionDeclared('cancelled', 'draft')).toBe(false);
  });

  it('every non-reachable declared transition carries a reason', () => {
    for (const t of ORDER_TRANSITIONS.filter((x) => !x.reachable)) expect(t.note).toBeTruthy();
  });

  it('every pair outside the table is denied', () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        if (!isOrderTransitionDeclared(from, to)) expect(canTransitionOrder(from, to)).toBe(false);
      }
    }
  });

  it('only draft, rejected-by-approver and awaiting approval are editable', () => {
    for (const s of ORDER_STATUSES) expect(isOrderEditable(s)).toBe(['draft', 'approval_rejected', 'awaiting_approval'].includes(s));
  });

  it('lists reachable targets', () => {
    expect([...reachableOrderTargets('draft')].sort()).toEqual(['awaiting_approval', 'cancelled', 'draft']);
    expect(reachableOrderTargets('queued')).toEqual([]);
  });
});

describe('outbox status transitions', () => {
  it('declares all five statuses', () => {
    expect([...OUTBOX_STATUSES].sort()).toEqual(
      ['confirmed', 'pending', 'processing', 'rejected', 'unknown'].sort(),
    );
  });

  it.each([
    ['pending', 'processing', true],
    ['processing', 'confirmed', true],
    ['processing', 'rejected', true],
    ['processing', 'unknown', true],
    ['processing', 'pending', true],
    ['unknown', 'confirmed', true],
    ['unknown', 'rejected', true],
    ['unknown', 'processing', false], // no blind retry: reconcile first (SNK-4)
    ['unknown', 'pending', false],
    ['pending', 'confirmed', false],
    ['pending', 'rejected', false],
    ['confirmed', 'pending', false],
    ['confirmed', 'processing', false],
    ['rejected', 'pending', false],
    ['rejected', 'processing', false],
  ] as [OutboxStatus, OutboxStatus, boolean][])('canTransitionOutbox %s -> %s = %s', (from, to, expected) => {
    expect(canTransitionOutbox(from, to)).toBe(expected);
  });

  it('confirmed and rejected are terminal', () => {
    for (const from of ['confirmed', 'rejected'] as const) {
      for (const to of OUTBOX_STATUSES) expect(canTransitionOutbox(from, to)).toBe(false);
    }
  });
});

describe('order approval states (ORD-1, ORD-2, SM-2)', () => {
  it('adds the approval states without touching the ERP ones', () => {
    for (const s of ['awaiting_approval', 'approved', 'approval_rejected']) expect(ORDER_STATUSES).toContain(s);
    expect(ORDER_STATUSES).toContain('rejected');
  });

  it.each([
    ['draft', 'awaiting_approval', true],
    ['awaiting_approval', 'approved', true],
    ['awaiting_approval', 'approval_rejected', true],
    ['awaiting_approval', 'draft', true], // an edit invalidates the pending approval
    ['approval_rejected', 'draft', true], // an edit of a reprovado order
    ['draft', 'cancelled', true],
    ['awaiting_approval', 'cancelled', true],
    ['approval_rejected', 'cancelled', true],
    ['approved', 'cancelled', true],
    ['approved', 'queued', false], // ERP submission stays disabled
    ['approved', 'draft', false],
    ['approval_rejected', 'approved', false], // a reprovação is never reverted without an edit
    ['approval_rejected', 'rejected', false], // never confuses with the ERP rejection
    ['awaiting_approval', 'rejected', false],
    ['draft', 'approved', false], // only an explicit approval (or, later, the ERP gate) approves
    ['cancelled', 'awaiting_approval', false],
  ] as [OrderStatus, OrderStatus, boolean][])('canTransitionOrder %s -> %s = %s', (from, to, expected) => {
    expect(canTransitionOrder(from, to)).toBe(expected);
  });

  it('is editable as draft, rejected-by-approver and awaiting approval (which returns to draft); never approved or sent', () => {
    for (const s of ['draft', 'approval_rejected', 'awaiting_approval'] as const) expect(isOrderEditable(s)).toBe(true);
    for (const s of ['approved', 'queued', 'sent', 'rejected', 'cancelled', 'unknown'] as const) expect(isOrderEditable(s)).toBe(false);
  });

  it('an edit always ends in draft', () => {
    expect(statusAfterEdit('draft')).toBe('draft');
    expect(statusAfterEdit('awaiting_approval')).toBe('draft');
    expect(statusAfterEdit('approval_rejected')).toBe('draft');
    expect(() => statusAfterEdit('approved')).toThrow();
  });
});
