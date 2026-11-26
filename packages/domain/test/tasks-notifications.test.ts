import { describe, expect, it } from 'vitest';
import {
  cancelTransition,
  canViewTask,
  completeTransition,
  customerNotification,
  isExpoPushToken,
  isReminderDue,
  normalizeTaskInput,
  orderNotification,
  pushMessageOf,
  reminderAt,
  taskReminderNotification,
} from '../src/index.js';

const base = { type: 'call', title: '  Ligar para o cliente ', description: null, dueAt: '2026-12-01T13:00:00.000Z', reminderLeadMinutes: 30 };

describe('normalizeTaskInput', () => {
  it('trims and accepts a valid task', () => {
    const r = normalizeTaskInput(base);
    expect(r.ok && r.value.title).toBe('Ligar para o cliente');
  });
  it('reports every problem', () => {
    const r = normalizeTaskInput({ ...base, type: 'x', title: ' ', dueAt: 'nope', reminderLeadMinutes: 7 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toEqual(['type_invalid', 'title_empty', 'due_at_invalid', 'reminder_invalid']);
  });
  it('blank description becomes null', () => {
    const r = normalizeTaskInput({ ...base, description: '   ' });
    expect(r.ok && r.value.description).toBeNull();
  });
});

describe('visibility', () => {
  const task = { assigneeAccountId: 'a1' };
  it('seller sees only own', () => {
    expect(canViewTask({ role: 'seller', accountId: 'a1' }, task)).toBe(true);
    expect(canViewTask({ role: 'seller', accountId: 'a2' }, task)).toBe(false);
  });
  it('manager and admin see all; technical and operations none', () => {
    expect(canViewTask({ role: 'manager', accountId: 'm' }, task)).toBe(true);
    expect(canViewTask({ role: 'admin', accountId: 'm' }, task)).toBe(true);
    expect(canViewTask({ role: 'technical', accountId: 'a1' }, task)).toBe(false);
    expect(canViewTask({ role: 'operations', accountId: 'a1' }, task)).toBe(false);
  });
});

describe('transitions', () => {
  it('complete is idempotent and refuses cancelled', () => {
    expect(completeTransition('pending')).toEqual({ ok: true, value: 'completed' });
    expect(completeTransition('completed')).toEqual({ ok: true, value: 'unchanged' });
    expect(completeTransition('cancelled').ok).toBe(false);
    expect(cancelTransition('completed').ok).toBe(false);
    expect(cancelTransition('cancelled')).toEqual({ ok: true, value: 'unchanged' });
  });
});

describe('reminders', () => {
  const due = new Date('2026-12-01T13:00:00.000Z');
  const task = { status: 'pending' as const, dueAt: due, reminderLeadMinutes: 30, remindedAt: null };
  it('fires from lead time until stale', () => {
    expect(reminderAt(due, 30)?.toISOString()).toBe('2026-12-01T12:30:00.000Z');
    expect(isReminderDue(task, new Date('2026-12-01T12:29:59Z'))).toBe(false);
    expect(isReminderDue(task, new Date('2026-12-01T12:30:00Z'))).toBe(true);
    expect(isReminderDue(task, new Date('2026-12-02T12:31:00Z'))).toBe(false);
  });
  it('never for done, already reminded or no reminder', () => {
    const now = new Date('2026-12-01T12:40:00Z');
    expect(isReminderDue({ ...task, status: 'completed' }, now)).toBe(false);
    expect(isReminderDue({ ...task, remindedAt: now }, now)).toBe(false);
    expect(isReminderDue({ ...task, reminderLeadMinutes: null }, now)).toBe(false);
  });
});

describe('notification content', () => {
  it('order events have stable dedupe keys and no money fields', () => {
    const e = orderNotification({ orderId: 'o1', draftNumber: 7, erpNumber: 900, kind: 'error' });
    expect(e.dedupeKey).toBe('order:o1:error');
    expect(e.title).toContain('900');
    const s = orderNotification({ orderId: 'o1', draftNumber: 7, erpNumber: null, kind: 'status', statusLabel: 'Aprovado', statusCode: 2 });
    expect(s.dedupeKey).toBe('order:o1:status:2');
    expect(s.body).toContain('Aprovado');
    expect(JSON.stringify([e, s])).not.toMatch(/custo|margem|R\$/i);
  });
  it('customer and task content', () => {
    expect(customerNotification({ registrationId: 'r', kind: 'rejected', customerName: 'ACME' }).title).toBe('Cliente recusado');
    const t = taskReminderNotification({ taskId: 't', title: 'Visita', dueAt: new Date('2026-12-01T13:00:00Z') });
    expect(t.dedupeKey).toBe('task:t:reminder:2026-12-01T13:00:00.000Z');
  });
  it('push message is clipped; token format', () => {
    expect(pushMessageOf({ title: 'a'.repeat(200), body: 'b'.repeat(500) }).body.length).toBeLessThanOrEqual(140);
    expect(isExpoPushToken('ExponentPushToken[abcdefgh12345]')).toBe(true);
    expect(isExpoPushToken('https://evil')).toBe(false);
  });
});
