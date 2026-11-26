/**
 * Notificações (RF-NOT-1/2): the content of each event, built ONLY from the fields listed here. Nothing that is
 * cost, margin, price or another user's data can reach a notification (or the push body) because no builder takes
 * such a field (P-20, P-21). The recipient is always decided by the server from the owner of the thing.
 */

export const NOTIFICATION_CATEGORIES = ['order', 'customer', 'task'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export type NotificationRefType = 'order' | 'customer_registration' | 'task';

export interface NotificationContent {
  readonly category: NotificationCategory;
  readonly title: string;
  readonly body: string;
  readonly refType: NotificationRefType;
  readonly refId: string;
  /** Unique per recipient: the same event never creates two notifications (idempotent generation). */
  readonly dedupeKey: string;
}

export const PUSH_TITLE_MAX = 60;
export const PUSH_BODY_MAX = 140;

function clip(text: string, max: number): string {
  const chars = [...text.trim().replace(/\s+/g, ' ')];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}

export type OrderNotificationKind = 'status' | 'invoiced' | 'error';

export interface OrderNotificationFacts {
  readonly orderId: string;
  /** Draft number shown to the seller; the ERP number when known. */
  readonly draftNumber: number;
  readonly erpNumber: number | null;
  readonly kind: OrderNotificationKind;
  /** Status label as the ERP reports it (only for `status`). */
  readonly statusLabel?: string | null;
  readonly statusCode?: number | null;
}

export function orderNotification(facts: OrderNotificationFacts): NotificationContent {
  const ref = facts.erpNumber === null ? `Pedido ${facts.draftNumber}` : `Pedido ${facts.erpNumber}`;
  const base = { category: 'order' as const, refType: 'order' as const, refId: facts.orderId };
  if (facts.kind === 'error') {
    return { ...base, title: clip(`${ref} com erro`, PUSH_TITLE_MAX), body: 'O pedido não foi aceito. Abra para ver o motivo.', dedupeKey: `order:${facts.orderId}:error` };
  }
  if (facts.kind === 'invoiced') {
    return { ...base, title: clip(`${ref} faturado`, PUSH_TITLE_MAX), body: 'O pedido foi faturado.', dedupeKey: `order:${facts.orderId}:invoiced` };
  }
  const label = (facts.statusLabel ?? '').trim();
  return {
    ...base,
    title: clip(`${ref} mudou de status`, PUSH_TITLE_MAX),
    body: clip(label === '' ? 'O status do pedido mudou.' : `Novo status: ${label}`, PUSH_BODY_MAX),
    dedupeKey: `order:${facts.orderId}:status:${facts.statusCode ?? label}`,
  };
}

export type CustomerNotificationKind = 'confirmed' | 'rejected';

export function customerNotification(facts: {
  readonly registrationId: string;
  readonly kind: CustomerNotificationKind;
  readonly customerName: string;
}): NotificationContent {
  const name = clip(facts.customerName, 80);
  const base = { category: 'customer' as const, refType: 'customer_registration' as const, refId: facts.registrationId };
  return facts.kind === 'confirmed'
    ? { ...base, title: 'Cliente confirmado', body: clip(`${name} foi cadastrado no Sankhya.`, PUSH_BODY_MAX), dedupeKey: `customer:${facts.registrationId}:confirmed` }
    : { ...base, title: 'Cliente recusado', body: clip(`${name} foi recusado pelo Sankhya.`, PUSH_BODY_MAX), dedupeKey: `customer:${facts.registrationId}:rejected` };
}

export function taskReminderNotification(facts: { readonly taskId: string; readonly title: string; readonly dueAt: Date }): NotificationContent {
  return {
    category: 'task',
    refType: 'task',
    refId: facts.taskId,
    title: 'Tarefa a vencer',
    body: clip(facts.title, PUSH_BODY_MAX),
    dedupeKey: `task:${facts.taskId}:reminder:${facts.dueAt.toISOString()}`,
  };
}

/** The push shows exactly the stored title and body, clipped; it never carries more than the notification row. */
export function pushMessageOf(content: { readonly title: string; readonly body: string }): { readonly title: string; readonly body: string } {
  return { title: clip(content.title, PUSH_TITLE_MAX), body: clip(content.body, PUSH_BODY_MAX) };
}

/** Expo push tokens look like `ExponentPushToken[...]` / `ExpoPushToken[...]`. */
export function isExpoPushToken(value: string): boolean {
  return /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,}\]$/.test(value);
}
