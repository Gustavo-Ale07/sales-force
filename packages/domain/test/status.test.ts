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
  type OrderStatus,
  type OutboxStatus,
} from '../src/index.js';

describe('order status transitions', () => {
  it('declares all six statuses', () => {
    expect([...ORDER_STATUSES].sort()).toEqual(
      ['cancelled', 'draft', 'queued', 'rejected', 'sent', 'unknown'].sort(),
    );
  });

  it('only draft edits and draft -> cancelled are reachable today', () => {
    const reachable = ORDER_TRANSITIONS.filter((t) => t.reachable).map((t) => `${t.from}->${t.to}`);
    expect(reachable.sort()).toEqual(['draft->cancelled', 'draft->draft']);
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

  it('only drafts are editable', () => {
    for (const s of ORDER_STATUSES) expect(isOrderEditable(s)).toBe(s === 'draft');
  });

  it('lists reachable targets', () => {
    expect([...reachableOrderTargets('draft')].sort()).toEqual(['cancelled', 'draft']);
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
