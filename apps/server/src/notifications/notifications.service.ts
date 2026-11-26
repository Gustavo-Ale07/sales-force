import { Inject, Injectable } from '@nestjs/common';
import type {
  MarkNotificationsReadRequest,
  NotificationsQuery,
  NotificationsResponse,
  RegisterPushDeviceRequest,
  UnreadCountResponse,
  UnregisterPushDeviceRequest,
} from '@salesforce/contracts';
import { notification, pushDevice, type Database } from '@salesforce/db';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AppError } from '../http/app-error.js';
import { AUDIT_ACTIONS, AuditService } from '../iam/audit.service.js';
import type { CurrentUser } from '../iam/current-user.js';
import { uuidv7 } from '../platform/ids.js';
import { CLOCK, DATABASE, type Clock } from '../platform/tokens.js';

const NOTIFICATION_ROLES = ['seller', 'manager', 'admin'];

/** Central of the caller (RF-NOT-1/2). Every query is bound to the caller account: nothing of another account is reachable. */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(user: CurrentUser, query: NotificationsQuery): Promise<NotificationsResponse> {
    this.requireRole(user);
    const rows = await this.db
      .select()
      .from(notification)
      .where(and(eq(notification.accountId, user.accountId), query.unreadOnly === true ? isNull(notification.readAt) : undefined))
      .orderBy(desc(notification.createdAt), desc(notification.id))
      .limit(query.limit);
    return {
      items: rows.map((row) => ({
        id: row.id,
        category: row.category as 'order' | 'customer' | 'task',
        title: row.title,
        body: row.body,
        refType: row.refType as 'order' | 'customer_registration' | 'task',
        refId: row.refId,
        readAt: row.readAt === null ? null : row.readAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      })),
      unreadCount: await this.unread(user.accountId),
    };
  }

  async markRead(user: CurrentUser, body: MarkNotificationsReadRequest): Promise<UnreadCountResponse> {
    this.requireRole(user);
    await this.db
      .update(notification)
      .set({ readAt: this.clock() })
      .where(
        and(
          eq(notification.accountId, user.accountId),
          isNull(notification.readAt),
          body.ids === undefined ? undefined : inArray(notification.id, body.ids),
        ),
      );
    return { unreadCount: await this.unread(user.accountId) };
  }

  async registerDevice(user: CurrentUser, body: RegisterPushDeviceRequest): Promise<void> {
    this.requireRole(user);
    const now = this.clock();
    await this.db.transaction(async (tx) => {
      await tx
        .insert(pushDevice)
        .values({ id: uuidv7(now.getTime()), accountId: user.accountId, token: body.token, platform: body.platform, createdAt: now, lastSeenAt: now })
        .onConflictDoUpdate({
          target: pushDevice.token,
          set: { accountId: user.accountId, platform: body.platform, lastSeenAt: now, disabledAt: null },
        });
      await this.audit.record(
        { action: AUDIT_ACTIONS.pushDeviceRegistered, actorAccountId: user.accountId, detail: { platform: body.platform } },
        tx,
      );
    });
  }

  async unregisterDevice(user: CurrentUser, body: UnregisterPushDeviceRequest): Promise<void> {
    this.requireRole(user);
    const now = this.clock();
    await this.db.transaction(async (tx) => {
      const removed = await tx
        .update(pushDevice)
        .set({ disabledAt: now })
        .where(and(eq(pushDevice.token, body.token), eq(pushDevice.accountId, user.accountId), isNull(pushDevice.disabledAt)))
        .returning({ id: pushDevice.id });
      if (removed.length > 0) {
        await this.audit.record({ action: AUDIT_ACTIONS.pushDeviceRemoved, actorAccountId: user.accountId, detail: {} }, tx);
      }
    });
  }

  private async unread(accountId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(notification)
      .where(and(eq(notification.accountId, accountId), isNull(notification.readAt)));
    return row?.n ?? 0;
  }

  private requireRole(user: CurrentUser): void {
    if (!NOTIFICATION_ROLES.includes(user.role)) throw new AppError('forbidden');
  }
}
