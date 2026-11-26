import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { CompleteTaskRequest, CreateTaskRequest, Task, TasksQuery, TasksResponse } from '@salesforce/contracts';
import {
  canChangeTask,
  cancelTransition,
  completeTransition,
  mayUseTasks,
  normalizeTaskInput,
  seesAllTasks,
  type CustomerScope,
} from '@salesforce/domain';
import { CustomersService } from '../customers/customers.service.js';
import { AppError } from '../http/app-error.js';
import { AUDIT_ACTIONS, AuditService } from '../iam/audit.service.js';
import type { CurrentUser } from '../iam/current-user.js';
import { PolicyService } from '../iam/policy.service.js';
import { CLOCK, type Clock } from '../platform/tokens.js';
import { TasksRepository, type TaskRow } from './tasks.repository.js';

export interface TaskResult {
  readonly task: Task;
  /** True when the request id had already created this very task (served as 200, not 201). */
  readonly replayed: boolean;
}

export function taskFingerprint(input: {
  readonly type: string;
  readonly title: string;
  readonly description: string | null;
  readonly dueAt: Date;
  readonly reminderLeadMinutes: number | null;
  readonly customerCode: number | null;
}): string {
  const canonical = JSON.stringify([
    'v1',
    input.type,
    input.title,
    input.description,
    input.dueAt.toISOString(),
    input.reminderLeadMinutes,
    input.customerCode,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

function toTask(row: TaskRow, assigneeName: string, customerName: string | null): Task {
  return {
    id: row.id,
    type: row.type as Task['type'],
    title: row.title,
    description: row.description,
    dueAt: row.dueAt.toISOString(),
    reminderLeadMinutes: row.reminderLeadMinutes,
    customerCode: row.customerCode,
    customerName,
    status: row.status as Task['status'],
    completedAt: row.completedAt === null ? null : row.completedAt.toISOString(),
    assigneeAccountId: row.assigneeAccountId,
    assigneeName,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Tasks (RF-ACT-1..3). Orchestration only: visibility and transitions are the domain rules
 * (`canViewTask`, `completeTransition`, ...). A seller sees and changes only their own tasks; manager and
 * admin see all (there is no team entity). A task of someone else is 404 for a seller, never 403.
 */
@Injectable()
export class TasksService {
  constructor(
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(TasksRepository) private readonly tasks: TasksRepository,
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(user: CurrentUser, query: TasksQuery): Promise<TasksResponse> {
    this.requireRole(user);
    const rows = await this.tasks.list({
      assigneeAccountId: seesAllTasks(user.role) ? null : user.accountId,
      status: query.status,
      customerCode: query.customerCode,
      limit: query.limit,
    });
    const codes = rows.flatMap((row) => (row.task.customerCode === null ? [] : [row.task.customerCode]));
    // The scope is resolved only when some task links a customer (names outside the scope stay hidden, P-21).
    const names = codes.length === 0 ? new Map<number, string>() : await this.tasks.customerNames(await this.policy.customerScope(user), codes);
    return {
      items: rows.map((row) =>
        toTask(row.task, row.assigneeName, row.task.customerCode === null ? null : (names.get(row.task.customerCode) ?? null)),
      ),
    };
  }

  async create(user: CurrentUser, body: CreateTaskRequest): Promise<TaskResult> {
    this.requireRole(user);
    const normalized = normalizeTaskInput(body);
    if (!normalized.ok) {
      throw new AppError('validation_failed', {
        details: { issues: normalized.error.map((code) => ({ path: code.split('_')[0] ?? '', code })) },
      });
    }
    const value = normalized.value;
    const fingerprint = taskFingerprint({ ...value, customerCode: body.customerCode });

    const existing = await this.tasks.findByRequest(user.accountId, body.id);
    if (existing !== null) return { task: await this.replay(existing, fingerprint, user), replayed: true };

    const scope = await this.policy.customerScope(user);
    if (body.customerCode !== null) await this.customers.requireVisible(scope, body.customerCode);

    const now = this.clock();
    const created = await this.tasks.transaction(async (tx) => {
      const row = await this.tasks.insert(
        {
          id: body.id,
          clientRequestId: body.id,
          requestHash: fingerprint,
          assigneeAccountId: user.accountId,
          createdByAccountId: user.accountId,
          type: value.type,
          title: value.title,
          description: value.description,
          dueAt: value.dueAt,
          reminderLeadMinutes: value.reminderLeadMinutes,
          customerCode: body.customerCode,
          status: 'pending',
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
        tx,
      );
      if (row === null) return null;
      await this.audit.record(
        { action: AUDIT_ACTIONS.taskCreated, actorAccountId: user.accountId, detail: { taskId: row.id, type: row.type } },
        tx,
      );
      return row;
    });
    if (created === null) {
      // A racing replay won the insert: serve it as the replay it is.
      const winner = await this.tasks.findByRequest(user.accountId, body.id);
      if (winner === null) throw new AppError('conflict');
      return { task: await this.replay(winner, fingerprint, user), replayed: true };
    }
    return { task: toTask(created, user.displayName, await this.nameOf(scope, created.customerCode)), replayed: false };
  }

  async complete(user: CurrentUser, id: string, body: CompleteTaskRequest): Promise<Task> {
    return this.change(user, id, async (current, tx) => {
      const transition = completeTransition(current.status as 'pending' | 'completed' | 'cancelled');
      if (!transition.ok) throw this.cancelledError();
      if (transition.value === 'unchanged') return { row: null, audit: false };
      const now = this.clock();
      // The device may have completed it earlier (offline); never in the future, never before creation.
      const requested = body.completedAt === undefined ? now : new Date(body.completedAt);
      const at = requested.getTime() > now.getTime() ? now : requested.getTime() < current.createdAt.getTime() ? current.createdAt : requested;
      return { row: await this.tasks.markCompleted(id, user.accountId, at, tx), audit: true, action: AUDIT_ACTIONS.taskCompleted };
    });
  }

  async cancel(user: CurrentUser, id: string): Promise<Task> {
    return this.change(user, id, async (current, tx) => {
      const transition = cancelTransition(current.status as 'pending' | 'completed' | 'cancelled');
      if (!transition.ok) {
        throw new AppError('conflict', { message: 'A tarefa já foi concluída e não pode ser cancelada.' });
      }
      if (transition.value === 'unchanged') return { row: null, audit: false };
      return { row: await this.tasks.markCancelled(id, this.clock(), tx), audit: true, action: AUDIT_ACTIONS.taskCancelled };
    });
  }

  private async change(
    user: CurrentUser,
    id: string,
    apply: (
      current: TaskRow,
      tx: Parameters<Parameters<TasksRepository['transaction']>[0]>[0],
    ) => Promise<{ row: TaskRow | null; audit: boolean; action?: typeof AUDIT_ACTIONS.taskCompleted | typeof AUDIT_ACTIONS.taskCancelled }>,
  ): Promise<Task> {
    this.requireRole(user);
    const found = await this.tasks.findById(id);
    if (found === null || !canChangeTask({ role: user.role, accountId: user.accountId }, found.task)) throw new AppError('not_found');
    await this.tasks.transaction(async (tx) => {
      const outcome = await apply(found.task, tx);
      if (outcome.audit && outcome.row !== null && outcome.action !== undefined) {
        await this.audit.record(
          { action: outcome.action, actorAccountId: user.accountId, detail: { taskId: id, type: found.task.type } },
          tx,
        );
      }
    });
    const fresh = await this.tasks.findById(id);
    if (fresh === null) throw new AppError('not_found');
    const scope = fresh.task.customerCode === null ? null : await this.policy.customerScope(user);
    return toTask(fresh.task, fresh.assigneeName, scope === null ? null : await this.nameOf(scope, fresh.task.customerCode));
  }

  private async replay(row: TaskRow, fingerprint: string, user: CurrentUser): Promise<Task> {
    if (row.requestHash !== fingerprint) throw new AppError('idempotency_conflict');
    const found = await this.tasks.findById(row.id);
    const scope = await this.policy.customerScope(user);
    return toTask(found?.task ?? row, found?.assigneeName ?? user.displayName, await this.nameOf(scope, row.customerCode));
  }

  private async nameOf(scope: CustomerScope, code: number | null): Promise<string | null> {
    if (code === null) return null;
    return (await this.tasks.customerNames(scope, [code])).get(code) ?? null;
  }

  private cancelledError(): AppError {
    return new AppError('conflict', { message: 'A tarefa foi cancelada e não pode ser concluída.' });
  }

  private requireRole(user: CurrentUser): void {
    if (!mayUseTasks(user.role)) throw new AppError('forbidden');
  }
}
