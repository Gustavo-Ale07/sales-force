import {
  account,
  activityTask,
  customerRegistration,
  notification,
  pushDevice,
  salesOrder,
  type Database,
} from '@salesforce/db';
import {
  customerNotification,
  isReminderDue,
  orderNotification,
  pushMessageOf,
  taskReminderNotification,
  type NotificationContent,
} from '@salesforce/domain';
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import type { Logger } from '../observability/logger.js';
import { uuidv7 } from '../platform/ids.js';
import type { Clock } from '../platform/tokens.js';

/** What a push needs: only the stored title and body, never anything else. */
export interface PushMessage {
  readonly to: string;
  readonly title: string;
  readonly body: string;
  readonly data: { readonly refType: string; readonly refId: string };
}
export type PushTicket = 'ok' | 'device_not_registered' | 'failed';

/** Port to the Expo push service; the real adapter is `ExpoPushSender`, tests use a fake (no network in tests). */
export interface PushSender {
  send(messages: readonly PushMessage[]): Promise<readonly PushTicket[]>;
}

/** Events older than this are never turned into notifications by the sweep (bounds the first run after a deploy). */
export const EVENT_WINDOW_MS = 6 * 3_600_000;
export const MAX_PUSH_ATTEMPTS = 3;
const PUSH_BATCH = 100;

export interface SweepSummary {
  readonly generated: number;
  readonly reminders: number;
  readonly pushed: number;
}

/**
 * One sweep (worker, every minute): (1) turns order and customer events into notifications, (2) fires task
 * reminders, (3) pushes pending notifications. Every step is idempotent: a notification is unique per
 * (account, dedupe key), a reminder is marked in the same transaction, a push leaves `pending` only once.
 * Recipients are always the account that created the order/customer/task; content comes from the domain
 * builders, which take no cost, margin or price fields.
 */
export class NotificationSweepService {
  constructor(
    private readonly deps: { readonly db: Database; readonly sender: PushSender; readonly now: Clock; readonly logger: Logger },
  ) {}

  async run(): Promise<SweepSummary> {
    const generated = await this.generateEvents();
    const reminders = await this.generateReminders();
    const pushed = await this.dispatchPush();
    return { generated, reminders, pushed };
  }

  private async insert(accountId: string, content: NotificationContent, at: Date): Promise<boolean> {
    const rows = await this.deps.db
      .insert(notification)
      .values({
        id: uuidv7(at.getTime()),
        accountId,
        category: content.category,
        title: content.title,
        body: content.body,
        refType: content.refType,
        refId: content.refId,
        dedupeKey: content.dedupeKey,
        createdAt: at,
      })
      .onConflictDoNothing()
      .returning({ id: notification.id });
    return rows.length > 0;
  }

  private async generateEvents(): Promise<number> {
    const now = this.deps.now();
    const since = new Date(now.getTime() - EVENT_WINDOW_MS);
    let created = 0;

    const orders = await this.deps.db
      .select({
        id: salesOrder.id,
        accountId: salesOrder.createdByAccountId,
        draftNumber: salesOrder.draftNumber,
        erpNumber: salesOrder.erpNumber,
        status: salesOrder.status,
        erpStatusCode: salesOrder.erpStatusCode,
        erpStatusLabel: salesOrder.erpStatusLabel,
        erpInvoiceNumber: salesOrder.erpInvoiceNumber,
      })
      .from(salesOrder)
      .where(
        and(
          gte(salesOrder.updatedAt, since),
          isNull(salesOrder.erpRemovedAt),
          or(eq(salesOrder.status, 'rejected'), isNotNull(salesOrder.erpStatusCode), isNotNull(salesOrder.erpInvoiceNumber)),
        ),
      );
    for (const order of orders) {
      const base = { orderId: order.id, draftNumber: order.draftNumber, erpNumber: order.erpNumber };
      const contents: NotificationContent[] = [];
      if (order.status === 'rejected') contents.push(orderNotification({ ...base, kind: 'error' }));
      if (order.erpInvoiceNumber !== null) contents.push(orderNotification({ ...base, kind: 'invoiced' }));
      else if (order.erpStatusCode !== null) {
        contents.push(orderNotification({ ...base, kind: 'status', statusCode: order.erpStatusCode, statusLabel: order.erpStatusLabel }));
      }
      for (const content of contents) if (await this.insert(order.accountId, content, now)) created += 1;
    }

    const registrations = await this.deps.db
      .select({
        id: customerRegistration.id,
        accountId: customerRegistration.createdByAccountId,
        name: customerRegistration.name,
        status: customerRegistration.status,
      })
      .from(customerRegistration)
      .where(and(gte(customerRegistration.updatedAt, since), inArray(customerRegistration.status, ['confirmed', 'rejected'])));
    for (const registration of registrations) {
      const content = customerNotification({
        registrationId: registration.id,
        customerName: registration.name,
        kind: registration.status === 'confirmed' ? 'confirmed' : 'rejected',
      });
      if (await this.insert(registration.accountId, content, now)) created += 1;
    }
    return created;
  }

  private async generateReminders(): Promise<number> {
    const now = this.deps.now();
    const rows = await this.deps.db
      .select()
      .from(activityTask)
      .where(and(eq(activityTask.status, 'pending'), isNull(activityTask.remindedAt), isNotNull(activityTask.reminderLeadMinutes), lt(activityTask.dueAt, new Date(now.getTime() + 1440 * 60_000 + 1))))
      .orderBy(asc(activityTask.dueAt))
      .limit(500);
    let fired = 0;
    for (const task of rows) {
      if (!isReminderDue(task as Parameters<typeof isReminderDue>[0], now)) continue;
      const content = taskReminderNotification({ taskId: task.id, title: task.title, dueAt: task.dueAt });
      await this.deps.db.transaction(async (tx) => {
        // Mark first: a reminder is sent at most once even when two sweeps overlap.
        const marked = await tx
          .update(activityTask)
          .set({ remindedAt: now })
          .where(and(eq(activityTask.id, task.id), isNull(activityTask.remindedAt), eq(activityTask.status, 'pending')))
          .returning({ id: activityTask.id });
        if (marked.length === 0) return;
        await tx
          .insert(notification)
          .values({
            id: uuidv7(now.getTime()),
            accountId: task.assigneeAccountId,
            category: content.category,
            title: content.title,
            body: content.body,
            refType: content.refType,
            refId: content.refId,
            dedupeKey: content.dedupeKey,
            createdAt: now,
          })
          .onConflictDoNothing();
        fired += 1;
      });
    }
    return fired;
  }

  private async dispatchPush(): Promise<number> {
    const now = this.deps.now();
    const pending = await this.deps.db
      .select()
      .from(notification)
      .where(and(eq(notification.pushState, 'pending'), gte(notification.createdAt, new Date(now.getTime() - 24 * 3_600_000))))
      .orderBy(asc(notification.createdAt))
      .limit(PUSH_BATCH);
    let sent = 0;
    for (const item of pending) {
      const devices = await this.deps.db
        .select({ id: pushDevice.id, token: pushDevice.token })
        .from(pushDevice)
        .innerJoin(account, eq(account.id, pushDevice.accountId))
        .where(
          and(
            eq(pushDevice.accountId, item.accountId),
            isNull(pushDevice.disabledAt),
            eq(account.status, 'active'),
          ),
        );
      if (devices.length === 0) {
        await this.deps.db.update(notification).set({ pushState: 'skipped' }).where(eq(notification.id, item.id));
        continue;
      }
      const message = pushMessageOf(item);
      let tickets: readonly PushTicket[];
      try {
        tickets = await this.deps.sender.send(
          devices.map((device) => ({ to: device.token, ...message, data: { refType: item.refType, refId: item.refId } })),
        );
      } catch (error) {
        this.deps.logger.warn({ err: error instanceof Error ? error.message : 'push_send_failed' }, 'push dispatch failed');
        const attempts = item.pushAttempts + 1;
        await this.deps.db
          .update(notification)
          .set({ pushAttempts: attempts, pushState: attempts >= MAX_PUSH_ATTEMPTS ? 'failed' : 'pending' })
          .where(eq(notification.id, item.id));
        continue;
      }
      const dead = devices.filter((_, index) => tickets[index] === 'device_not_registered').map((device) => device.id);
      if (dead.length > 0) {
        await this.deps.db.update(pushDevice).set({ disabledAt: now }).where(inArray(pushDevice.id, dead));
      }
      const anyOk = tickets.some((ticket) => ticket === 'ok');
      await this.deps.db
        .update(notification)
        .set({
          pushState: anyOk ? 'sent' : 'failed',
          pushedAt: anyOk ? now : null,
          pushAttempts: sql`${notification.pushAttempts} + 1`,
        })
        .where(eq(notification.id, item.id));
      if (anyOk) sent += 1;
    }
    return sent;
  }
}
