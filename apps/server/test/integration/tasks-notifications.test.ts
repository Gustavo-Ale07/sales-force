import { randomUUID } from 'node:crypto';
import { TaskSchema, TasksResponseSchema, NotificationsResponseSchema } from '@salesforce/contracts';
import { activityTask, notification, pushDevice, salesOrder } from '@salesforce/db';
import { DEMO_ACCOUNT_EMAILS, getDemoDataset } from '@salesforce/sankhya';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/observability/logger.js';
import {
  NotificationSweepService,
  type PushMessage,
  type PushSender,
  type PushTicket,
} from '../../src/notifications/notification-sweep.service.js';
import { restrictedKeys, startCommercialApp, type CommercialApp } from '../helpers/commercial-app.js';
import { closeAllThenStop, startPostgres, type TestPostgres } from '../helpers/postgres.js';

const dataset = getDemoDataset();
let postgres: TestPostgres;
const opened: (() => Promise<unknown>)[] = [];
let ctx: CommercialApp;
let customer1: number; // seller 103
let customer2: number; // seller 107

class FakeSender implements PushSender {
  readonly sent: PushMessage[] = [];
  next: PushTicket = 'ok';
  async send(messages: readonly PushMessage[]): Promise<readonly PushTicket[]> {
    this.sent.push(...messages);
    return messages.map(() => this.next);
  }
}

beforeAll(async () => {
  postgres = await startPostgres();
  ctx = await startCommercialApp(postgres, opened);
  const own = (seller: number) => dataset.customers.find((c) => c.sellerCode === seller && c.active && !c.blocked);
  customer1 = own(103)!.code;
  customer2 = own(107)!.code;
});

afterAll(async () => {
  await closeAllThenStop(opened, postgres);
});

const db = () => ctx.database.handle.db;
const idOf = (who: 'seller1' | 'seller2' | 'manager' | 'admin') => ctx.accounts.ids[DEMO_ACCOUNT_EMAILS[who]]!;
const taskBody = (overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  type: 'call',
  title: 'Ligar para o cliente',
  description: null,
  dueAt: '2026-09-22T12:00:00.000Z',
  reminderLeadMinutes: 30,
  customerCode: null,
  ...overrides,
});

describe('tasks', () => {
  it('creates once and replays idempotently (201 then 200); another payload with the same id is 409', async () => {
    const body = taskBody({ customerCode: customer1 });
    const first = await ctx.call('seller1', 'POST', '/tasks', body);
    expect(first.status).toBe(201);
    expect(TaskSchema.parse(first.body).status).toBe('pending');
    const replay = await ctx.call('seller1', 'POST', '/tasks', body);
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
    const conflict = await ctx.call('seller1', 'POST', '/tasks', { ...body, title: 'Outro título' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('idempotency_conflict');
    expect(await db().select().from(activityTask).where(eq(activityTask.id, body.id))).toHaveLength(1);
  });

  it('refuses a customer outside the seller scope (404) and an invalid title (400)', async () => {
    expect((await ctx.call('seller1', 'POST', '/tasks', taskBody({ customerCode: customer2 }))).status).toBe(404);
    expect((await ctx.call('seller1', 'POST', '/tasks', taskBody({ title: '   ' }))).status).toBe(400);
  });

  it('a seller sees only own tasks, a manager sees all; a foreign task is 404 for a seller', async () => {
    const mine = await ctx.call('seller1', 'POST', '/tasks', taskBody({ title: 'Minha tarefa vendedor 1' }));
    const other = await ctx.call('seller2', 'POST', '/tasks', taskBody({ title: 'Tarefa do vendedor 2' }));
    const sellerList = TasksResponseSchema.parse((await ctx.call('seller1', 'GET', '/tasks')).body);
    expect(sellerList.items.some((t) => t.id === mine.body.id)).toBe(true);
    expect(sellerList.items.some((t) => t.id === other.body.id)).toBe(false);
    const managerList = TasksResponseSchema.parse((await ctx.call('manager', 'GET', '/tasks')).body);
    expect(managerList.items.some((t) => t.id === other.body.id)).toBe(true);
    expect((await ctx.call('seller1', 'POST', `/tasks/${other.body.id}/complete`, {})).status).toBe(404);
    expect((await ctx.call('manager', 'POST', `/tasks/${other.body.id}/complete`, {})).status).toBe(200);
  });

  it('completes idempotently, refuses completing a cancelled task and cancelling a completed one', async () => {
    const a = await ctx.call('seller1', 'POST', '/tasks', taskBody());
    const done = await ctx.call('seller1', 'POST', `/tasks/${a.body.id}/complete`, {});
    const again = await ctx.call('seller1', 'POST', `/tasks/${a.body.id}/complete`, {});
    expect(done.body.status).toBe('completed');
    expect(again.status).toBe(200);
    expect(again.body.version).toBe(done.body.version);
    expect((await ctx.call('seller1', 'POST', `/tasks/${a.body.id}/cancel`)).status).toBe(409);
    const b = await ctx.call('seller1', 'POST', '/tasks', taskBody());
    expect((await ctx.call('seller1', 'POST', `/tasks/${b.body.id}/cancel`)).body.status).toBe('cancelled');
    expect((await ctx.call('seller1', 'POST', `/tasks/${b.body.id}/complete`, {})).status).toBe(409);
  });

  it('never exposes cost or margin keys', async () => {
    expect(restrictedKeys((await ctx.call('manager', 'GET', '/tasks')).body)).toEqual([]);
  });
});

describe('notifications', () => {
  const sweepOf = (sender: PushSender) =>
    new NotificationSweepService({ db: db(), sender, now: ctx.clock.fn, logger: createLogger({ level: 'silent', service: 'worker' }) });

  it('fires a task reminder once, pushes it to the owner device only, and never repeats', async () => {
    const sender = new FakeSender();
    const token = 'ExponentPushToken[testtoken00001]';
    expect((await ctx.call('seller1', 'PUT', '/push-devices', { token, platform: 'android' })).status).toBe(204);
    const task = await ctx.call(
      'seller1',
      'POST',
      '/tasks',
      taskBody({ title: 'Reunião com Cliente X', dueAt: new Date(ctx.clock.fn().getTime() + 10 * 60_000).toISOString(), reminderLeadMinutes: 15 }),
    );
    const sweep = sweepOf(sender);
    const first = await sweep.run();
    expect(first.reminders).toBeGreaterThanOrEqual(1);
    const second = await sweep.run();
    expect(second.reminders).toBe(0);
    const mine = NotificationsResponseSchema.parse((await ctx.call('seller1', 'GET', '/notifications')).body);
    const reminder = mine.items.find((n) => n.refId === task.body.id);
    expect(reminder?.category).toBe('task');
    expect(mine.unreadCount).toBeGreaterThan(0);
    expect(sender.sent.filter((m) => m.data.refId === task.body.id)).toHaveLength(1);
    expect(sender.sent.every((m) => m.to === token)).toBe(true);
    expect((await ctx.call('seller2', 'GET', '/notifications')).body.items.some((n: { refId: string }) => n.refId === task.body.id)).toBe(false);
    expect(restrictedKeys(mine)).toEqual([]);
    const read = await ctx.call('seller1', 'POST', '/notifications/read', {});
    expect(read.body.unreadCount).toBe(0);
  });

  it('generates order notifications from ERP events once per event (dedupe) with no price data in the push', async () => {
    const sender = new FakeSender();
    const sellerId = idOf('seller1');
    const orderId = randomUUID();
    await ctx.database.handle.pool.query(
      `insert into sales_order (id, client_request_id, customer_code, seller_code, created_by_account_id, config_version_id, status, erp_status_code, erp_status_label, erp_invoice_number, erp_number, dataset_origin, erp_environment)
       select $1, $2, $3, 103, $4, $5, 'sent', 3, 'Aprovado', 99887, 4455, 'sankhya', 'sandbox' returning id`.replace(/ returning id/, ''),
      [orderId, randomUUID(), customer1, sellerId, ctx.accounts.configVersionId],
    );
    await db().select({ id: salesOrder.id }).from(salesOrder).where(eq(salesOrder.id, orderId));
    const sweep = sweepOf(sender);
    await sweep.run();
    await sweep.run();
    const rows = await db().select().from(notification).where(eq(notification.refId, orderId));
    expect(rows.map((r) => r.dedupeKey).sort()).toEqual([`order:${orderId}:invoiced`]);
    for (const row of rows) expect(`${row.title} ${row.body}`).not.toMatch(/R\$|custo|margem/i);
  });

  it('disables a device the push service reports as not registered', async () => {
    const sender = new FakeSender();
    sender.next = 'device_not_registered';
    const token = 'ExponentPushToken[deadtoken00001]';
    await ctx.call('seller2', 'PUT', '/push-devices', { token, platform: 'ios' });
    await ctx.call('seller2', 'POST', '/tasks', taskBody({ dueAt: new Date(ctx.clock.fn().getTime() + 5 * 60_000).toISOString(), reminderLeadMinutes: 15 }));
    await sweepOf(sender).run();
    const [device] = await db().select().from(pushDevice).where(eq(pushDevice.token, token));
    expect(device?.disabledAt).not.toBeNull();
  });

  it('re-registering a token moves it to the new account and unregistering is idempotent', async () => {
    const token = 'ExponentPushToken[movedtoken0001]';
    await ctx.call('seller1', 'PUT', '/push-devices', { token, platform: 'android' });
    await ctx.call('manager', 'PUT', '/push-devices', { token, platform: 'android' });
    const [row] = await db().select().from(pushDevice).where(eq(pushDevice.token, token));
    expect(row?.accountId).toBe(idOf('manager'));
    expect((await ctx.call('manager', 'POST', '/push-devices/remove', { token })).status).toBe(204);
    expect((await ctx.call('manager', 'POST', '/push-devices/remove', { token })).status).toBe(204);
  });
});
