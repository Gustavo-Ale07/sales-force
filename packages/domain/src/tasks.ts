import { err, ok, type Result } from './result.js';

/**
 * Tarefas (RF-ACT-1..3): rules that do not depend on infrastructure. Who may see a task is decided here (a seller
 * sees only the tasks assigned to them; manager and admin see every task, the same whole-portfolio rule as
 * `resolveCustomerScope` since the installation has no team entity yet); persistence, idempotency and audit stay
 * in the server.
 */

export const TASK_TYPES = ['call', 'visit', 'email', 'whatsapp', 'meeting', 'other'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = ['pending', 'completed', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_TITLE_MAX = 120;
export const TASK_DESCRIPTION_MAX = 2000;
/** Minutes before the due time at which the reminder fires; `null` = no reminder. */
export const TASK_REMINDER_LEADS = [0, 15, 30, 60, 120, 1440] as const;
/** A reminder older than this past its fire time is no longer sent (the due time is long gone). */
export const TASK_REMINDER_STALE_MS = 12 * 3_600_000;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

export type TaskInputError =
  | 'type_invalid'
  | 'title_empty'
  | 'title_too_long'
  | 'title_control_characters'
  | 'description_too_long'
  | 'description_control_characters'
  | 'due_at_invalid'
  | 'reminder_invalid';

export interface TaskInput {
  readonly type: string;
  readonly title: string;
  readonly description: string | null;
  /** ISO instant. */
  readonly dueAt: string;
  readonly reminderLeadMinutes: number | null;
}

export interface NormalizedTask {
  readonly type: TaskType;
  readonly title: string;
  readonly description: string | null;
  readonly dueAt: Date;
  readonly reminderLeadMinutes: number | null;
}

export function isTaskType(value: string): value is TaskType {
  return (TASK_TYPES as readonly string[]).includes(value);
}

/** Validates and canonicalizes a task as typed by the user; every problem is reported, none is fixed silently. */
export function normalizeTaskInput(input: TaskInput): Result<NormalizedTask, readonly TaskInputError[]> {
  const errors: TaskInputError[] = [];
  if (!isTaskType(input.type)) errors.push('type_invalid');

  const title = input.title.trim();
  if (title === '') errors.push('title_empty');
  else if (CONTROL_CHARACTERS.test(title)) errors.push('title_control_characters');
  else if ([...title].length > TASK_TITLE_MAX) errors.push('title_too_long');

  let description: string | null = null;
  if (input.description !== null) {
    const trimmed = input.description.trim();
    if (CONTROL_CHARACTERS.test(trimmed)) errors.push('description_control_characters');
    else if ([...trimmed].length > TASK_DESCRIPTION_MAX) errors.push('description_too_long');
    else description = trimmed === '' ? null : trimmed;
  }

  const dueAt = new Date(input.dueAt);
  if (Number.isNaN(dueAt.getTime())) errors.push('due_at_invalid');

  const lead = input.reminderLeadMinutes;
  if (lead !== null && !(TASK_REMINDER_LEADS as readonly number[]).includes(lead)) errors.push('reminder_invalid');

  if (errors.length > 0) return err(errors);
  return ok({ type: input.type as TaskType, title, description, dueAt, reminderLeadMinutes: lead });
}

/** The instant the reminder fires, or `null` when the task has none. */
export function reminderAt(dueAt: Date, leadMinutes: number | null): Date | null {
  return leadMinutes === null ? null : new Date(dueAt.getTime() - leadMinutes * 60_000);
}

/** True when a still-pending task has a reminder that is due now and was not sent yet (and is not stale). */
export function isReminderDue(
  task: { readonly status: TaskStatus; readonly dueAt: Date; readonly reminderLeadMinutes: number | null; readonly remindedAt: Date | null },
  now: Date,
): boolean {
  if (task.status !== 'pending' || task.remindedAt !== null) return false;
  const at = reminderAt(task.dueAt, task.reminderLeadMinutes);
  if (at === null) return false;
  const late = now.getTime() - at.getTime();
  return late >= 0 && late <= TASK_REMINDER_STALE_MS;
}

/* ---------- visibility ---------- */

export interface TaskActor {
  readonly role: string;
  readonly accountId: string;
}

/** Whole-team view: manager and admin. The `technical` and `operations` profiles never see tasks. */
export function seesAllTasks(role: string): boolean {
  return role === 'manager' || role === 'admin';
}

export function mayUseTasks(role: string): boolean {
  return role === 'seller' || seesAllTasks(role);
}

export function canViewTask(actor: TaskActor, task: { readonly assigneeAccountId: string }): boolean {
  if (!mayUseTasks(actor.role)) return false;
  return seesAllTasks(actor.role) || task.assigneeAccountId === actor.accountId;
}

/** Complete or cancel: the assignee, or a manager/admin. */
export function canChangeTask(actor: TaskActor, task: { readonly assigneeAccountId: string }): boolean {
  return canViewTask(actor, task);
}

export type TaskTransitionError = 'already_cancelled' | 'already_completed';

/** Completing is idempotent (a completed task stays completed); a cancelled task cannot be completed. */
export function completeTransition(status: TaskStatus): Result<'completed' | 'unchanged', TaskTransitionError> {
  if (status === 'cancelled') return err('already_cancelled');
  return ok(status === 'completed' ? 'unchanged' : 'completed');
}

export function cancelTransition(status: TaskStatus): Result<'cancelled' | 'unchanged', TaskTransitionError> {
  if (status === 'completed') return err('already_completed');
  return ok(status === 'cancelled' ? 'unchanged' : 'cancelled');
}
