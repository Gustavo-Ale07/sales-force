import { Inject, Injectable } from '@nestjs/common';
import { account, activityTask, erpCustomer, type Database } from '@salesforce/db';
import type { CustomerScope, TaskStatus } from '@salesforce/domain';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Executor } from '../orders/orders.repository.js';
import { inSellerCodes } from '../platform/sql.js';
import { DATABASE } from '../platform/tokens.js';

export type TaskRow = typeof activityTask.$inferSelect;
export type NewTask = typeof activityTask.$inferInsert;
export interface TaskWithAssignee {
  readonly task: TaskRow;
  readonly assigneeName: string;
}

/** Storage of tasks. Visibility is decided by the service with the domain rule; this layer only filters by assignee when told to. */
@Injectable()
export class TasksRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(filter: {
    readonly assigneeAccountId: string | null;
    readonly status?: TaskStatus | undefined;
    readonly customerCode?: number | undefined;
    readonly limit: number;
  }): Promise<TaskWithAssignee[]> {
    const rows = await this.db
      .select({ task: activityTask, assigneeName: account.displayName })
      .from(activityTask)
      .innerJoin(account, eq(account.id, activityTask.assigneeAccountId))
      .where(
        and(
          filter.assigneeAccountId === null ? undefined : eq(activityTask.assigneeAccountId, filter.assigneeAccountId),
          filter.status === undefined ? undefined : eq(activityTask.status, filter.status),
          filter.customerCode === undefined ? undefined : eq(activityTask.customerCode, filter.customerCode),
        ),
      )
      .orderBy(asc(activityTask.dueAt), asc(activityTask.id))
      .limit(filter.limit);
    return rows;
  }

  async findById(id: string, executor: Executor = this.db): Promise<TaskWithAssignee | null> {
    const [row] = await executor
      .select({ task: activityTask, assigneeName: account.displayName })
      .from(activityTask)
      .innerJoin(account, eq(account.id, activityTask.assigneeAccountId))
      .where(eq(activityTask.id, id))
      .limit(1);
    return row ?? null;
  }

  async findByRequest(accountId: string, clientRequestId: string): Promise<TaskRow | null> {
    const [row] = await this.db
      .select()
      .from(activityTask)
      .where(and(eq(activityTask.createdByAccountId, accountId), eq(activityTask.clientRequestId, clientRequestId)))
      .limit(1);
    return row ?? null;
  }

  /** Inserts; `null` when the id or the (creator, request id) pair already exists (a racing replay). */
  async insert(row: NewTask, tx: Executor): Promise<TaskRow | null> {
    const [created] = await tx.insert(activityTask).values(row).onConflictDoNothing().returning();
    return created ?? null;
  }

  /** Pending -> completed in one statement; `null` when it was not pending (the caller re-reads). */
  async markCompleted(id: string, by: string, at: Date, tx: Executor): Promise<TaskRow | null> {
    const [row] = await tx
      .update(activityTask)
      .set({ status: 'completed', completedAt: at, completedByAccountId: by, version: sql`${activityTask.version} + 1`, updatedAt: at })
      .where(and(eq(activityTask.id, id), eq(activityTask.status, 'pending')))
      .returning();
    return row ?? null;
  }

  async markCancelled(id: string, at: Date, tx: Executor): Promise<TaskRow | null> {
    const [row] = await tx
      .update(activityTask)
      .set({ status: 'cancelled', version: sql`${activityTask.version} + 1`, updatedAt: at })
      .where(and(eq(activityTask.id, id), eq(activityTask.status, 'pending')))
      .returning();
    return row ?? null;
  }

  transaction<T>(work: (tx: Executor) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  /** Names of the customers INSIDE the scope; any other code is simply absent (P-21). */
  async customerNames(scope: CustomerScope, codes: readonly number[]): Promise<Map<number, string>> {
    const unique = [...new Set(codes)];
    if (unique.length === 0) return new Map();
    const rows = await this.db
      .select({ code: erpCustomer.code, name: erpCustomer.name })
      .from(erpCustomer)
      .where(
        and(
          inArray(erpCustomer.code, unique),
          isNull(erpCustomer.deletedAt),
          scope.kind === 'all' ? undefined : inSellerCodes(erpCustomer.sellerCode, scope.sellerCodes),
        ),
      );
    return new Map(rows.map((row) => [row.code, row.name]));
  }
}
