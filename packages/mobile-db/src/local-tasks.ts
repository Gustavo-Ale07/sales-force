import type { SqlDatabase, SqlExecutor, SqlRow } from "./connection";
import { DatasetUnavailableError, readExpectedDataset, sameDataset, type DatasetIdentity } from "./dataset-identity";
import { isoNow, type OfflineEnv } from "./offline-env";
import { classifyFailure, TransportError } from "./order-sync";

/**
 * Tarefas offline (RF-ACT-1..3). The task id is minted on the device and is the idempotency key of the server (`POST /tasks`); completing and
 * cancelling replay safely (the server answers the same). One row per task holds the device copy AND the pending commands, so a task created
 * and completed while offline is sent as create, then complete, in that order. No cost or margin (P-20).
 *
 * `sync_state`: synced | queued | sending | rejected. The server outcome is authoritative: a pull overwrites a `synced` row, never a pending one.
 */
export type TaskType = "call" | "visit" | "email" | "whatsapp" | "meeting" | "other";
export type TaskStatus = "pending" | "completed" | "cancelled";
export type TaskSyncState = "synced" | "queued" | "sending" | "rejected";

export interface LocalTask {
  readonly id: string;
  readonly type: TaskType;
  readonly title: string;
  readonly description: string | null;
  readonly dueAt: string;
  readonly reminderLeadMinutes: number | null;
  readonly customerCode: number | null;
  readonly customerName: string | null;
  readonly status: TaskStatus;
  readonly completedAt: string | null;
  readonly syncState: TaskSyncState;
  readonly lastError: string | null;
}

/** The server's task as the app reads it (`GET /tasks`). */
export interface RemoteTask {
  readonly id: string;
  readonly type: TaskType;
  readonly title: string;
  readonly description: string | null;
  readonly dueAt: string;
  readonly reminderLeadMinutes: number | null;
  readonly customerCode: number | null;
  readonly customerName: string | null;
  readonly status: TaskStatus;
  readonly completedAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TaskTransport {
  /** `POST /tasks`; the id is the idempotency key (201 first time, 200 on replay). */
  createTask(task: NewTaskInput & { readonly id: string }): Promise<RemoteTask>;
  completeTask(id: string, completedAt: string | null): Promise<RemoteTask>;
  cancelTask(id: string): Promise<RemoteTask>;
  listTasks(): Promise<readonly RemoteTask[]>;
}

export interface NewTaskInput {
  readonly type: TaskType;
  readonly title: string;
  readonly description: string | null;
  readonly dueAt: string;
  readonly reminderLeadMinutes: number | null;
  readonly customerCode: number | null;
  readonly customerName?: string | null;
}

export class TaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskError";
  }
}

function toTask(row: SqlRow): LocalTask {
  const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
  const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));
  return {
    id: String(row.id),
    type: String(row.task_type) as TaskType,
    title: String(row.title),
    description: text(row.description),
    dueAt: String(row.due_at),
    reminderLeadMinutes: num(row.reminder_lead_minutes),
    customerCode: num(row.customer_code),
    customerName: text(row.customer_name),
    status: String(row.status) as TaskStatus,
    completedAt: text(row.completed_at),
    syncState: String(row.sync_state) as TaskSyncState,
    lastError: text(row.last_error),
  };
}

async function nextSeq(db: SqlExecutor): Promise<number> {
  const rows = await db.query<SqlRow>("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM local_task");
  return Number(rows[0]?.n ?? 1);
}

/** Saves a task on the device; it is sent on the next sync. */
export async function createLocalTask(db: SqlDatabase, env: OfflineEnv, ownerAccountId: string, input: NewTaskInput): Promise<LocalTask> {
  const title = input.title.trim();
  if (title.length === 0 || title.length > 120) throw new TaskError("Informe o título da tarefa (até 120 caracteres).");
  if (Number.isNaN(Date.parse(input.dueAt))) throw new TaskError("Informe a data e a hora da tarefa.");
  return db.transaction(async (tx) => {
    const dataset = await readExpectedDataset(tx);
    if (dataset === null) throw new DatasetUnavailableError();
    const id = env.newId();
    const now = isoNow(env);
    await tx.execute(
      `INSERT INTO local_task (id, owner_account_id, dataset_environment, dataset_id, task_type, title, description, due_at, reminder_lead_minutes, customer_code, customer_name,
         status, completed_at, version, created_at, updated_at, sync_state, pending_create, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, 1, ?, ?, 'queued', 1, ?)`,
      [id, ownerAccountId, dataset.environment, dataset.datasetId, input.type, title, input.description, input.dueAt, input.reminderLeadMinutes, input.customerCode, input.customerName ?? null, now, now, await nextSeq(tx)],
    );
    return toTask((await tx.query<SqlRow>("SELECT * FROM local_task WHERE id = ?", [id]))[0] as SqlRow);
  });
}

/** Marks a pending task as done on the device (queued for the server). Completing twice is a no-op. */
export async function completeLocalTask(db: SqlDatabase, env: OfflineEnv, ownerAccountId: string, id: string): Promise<LocalTask> {
  return db.transaction(async (tx) => {
    const row = (await tx.query<SqlRow>("SELECT * FROM local_task WHERE id = ? AND owner_account_id = ?", [id, ownerAccountId]))[0];
    if (row === undefined) throw new TaskError("Tarefa não encontrada.");
    if (String(row.status) === "completed") return toTask(row);
    if (String(row.status) === "cancelled") throw new TaskError("Uma tarefa cancelada não pode ser concluída.");
    const now = isoNow(env);
    await tx.execute(
      "UPDATE local_task SET status = 'completed', completed_at = ?, pending_complete_at = ?, sync_state = 'queued', last_error = NULL, updated_at = ?, seq = ? WHERE id = ?",
      [now, now, now, await nextSeq(tx), id],
    );
    return toTask((await tx.query<SqlRow>("SELECT * FROM local_task WHERE id = ?", [id]))[0] as SqlRow);
  });
}

export async function cancelLocalTask(db: SqlDatabase, env: OfflineEnv, ownerAccountId: string, id: string): Promise<LocalTask> {
  return db.transaction(async (tx) => {
    const row = (await tx.query<SqlRow>("SELECT * FROM local_task WHERE id = ? AND owner_account_id = ?", [id, ownerAccountId]))[0];
    if (row === undefined) throw new TaskError("Tarefa não encontrada.");
    if (String(row.status) === "cancelled") return toTask(row);
    if (String(row.status) === "completed") throw new TaskError("Uma tarefa concluída não pode ser cancelada.");
    const now = isoNow(env);
    await tx.execute("UPDATE local_task SET status = 'cancelled', pending_cancel = 1, sync_state = 'queued', last_error = NULL, updated_at = ?, seq = ? WHERE id = ?", [now, await nextSeq(tx), id]);
    return toTask((await tx.query<SqlRow>("SELECT * FROM local_task WHERE id = ?", [id]))[0] as SqlRow);
  });
}

export async function listLocalTasks(db: SqlExecutor, ownerAccountId: string, dataset: DatasetIdentity | null): Promise<LocalTask[]> {
  if (dataset === null) return [];
  const rows = await db.query<SqlRow>(
    "SELECT * FROM local_task WHERE owner_account_id = ? AND dataset_environment = ? AND dataset_id = ? ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, due_at",
    [ownerAccountId, dataset.environment, dataset.datasetId],
  );
  return rows.map(toTask);
}

export async function countPendingTasks(db: SqlExecutor, ownerAccountId: string): Promise<{ pending: number; needsAttention: number }> {
  const rows = await db.query<SqlRow>("SELECT sync_state, COUNT(*) AS n FROM local_task WHERE owner_account_id = ? AND sync_state <> 'synced' GROUP BY sync_state", [ownerAccountId]);
  let pending = 0;
  let needsAttention = 0;
  for (const row of rows) {
    if (String(row.sync_state) === "rejected") needsAttention += Number(row.n);
    else pending += Number(row.n);
  }
  return { pending, needsAttention };
}

export async function recoverInterruptedTasks(db: SqlExecutor): Promise<void> {
  await db.execute("UPDATE local_task SET sync_state = 'queued' WHERE sync_state = 'sending'");
}

export interface TaskPushResult {
  readonly attempted: number;
  readonly sent: number;
  readonly rejected: number;
  readonly stoppedBy: "idle" | "offline" | "auth" | "dataset_unconfirmed";
}

async function applyRemote(db: SqlExecutor, id: string, remote: RemoteTask, keepPending: { complete: boolean; cancel: boolean }): Promise<void> {
  await db.execute(
    `UPDATE local_task SET version = ?, status = ?, completed_at = ?, customer_name = COALESCE(?, customer_name), sync_state = ?, last_error = NULL, attempts = 0,
       pending_create = 0, pending_complete_at = CASE WHEN ? THEN pending_complete_at ELSE NULL END, pending_cancel = CASE WHEN ? THEN pending_cancel ELSE 0 END WHERE id = ?`,
    [remote.version, remote.status, remote.completedAt, remote.customerName, keepPending.complete || keepPending.cancel ? "queued" : "synced", keepPending.complete ? 1 : 0, keepPending.cancel ? 1 : 0, id],
  );
}

/**
 * Sends the owner's queued tasks in the order they were made: create (when new), then complete or cancel. Same id on every retry, so a lost
 * reply never makes a second task. A permanent refusal (validation, customer out of scope) marks the row `rejected` for the seller.
 */
export async function pushTasks(db: SqlDatabase, env: OfflineEnv, transport: TaskTransport, ownerAccountId: string, currentDataset: DatasetIdentity | null): Promise<TaskPushResult> {
  let attempted = 0;
  let sent = 0;
  let rejected = 0;
  if (currentDataset === null) return { attempted, sent, rejected, stoppedBy: "dataset_unconfirmed" };
  const rows = await db.query<SqlRow>(
    "SELECT * FROM local_task WHERE owner_account_id = ? AND dataset_environment = ? AND dataset_id = ? AND sync_state = 'queued' ORDER BY seq",
    [ownerAccountId, currentDataset.environment, currentDataset.datasetId],
  );
  for (const row of rows) {
    if (!sameDataset(await readExpectedDataset(db), currentDataset)) return { attempted, sent, rejected, stoppedBy: "dataset_unconfirmed" };
    const id = String(row.id);
    attempted += 1;
    await db.execute("UPDATE local_task SET sync_state = 'sending', attempts = attempts + 1, updated_at = ? WHERE id = ?", [isoNow(env), id]);
    try {
      let remote: RemoteTask | null = null;
      if (Number(row.pending_create) === 1) {
        remote = await transport.createTask({
          id,
          type: String(row.task_type) as TaskType,
          title: String(row.title),
          description: row.description === null ? null : String(row.description),
          dueAt: String(row.due_at),
          reminderLeadMinutes: row.reminder_lead_minutes === null ? null : Number(row.reminder_lead_minutes),
          customerCode: row.customer_code === null ? null : Number(row.customer_code),
        });
        await db.execute("UPDATE local_task SET pending_create = 0 WHERE id = ?", [id]);
      }
      if (row.pending_complete_at !== null && row.pending_complete_at !== undefined) remote = await transport.completeTask(id, String(row.pending_complete_at));
      else if (Number(row.pending_cancel) === 1) remote = await transport.cancelTask(id);
      if (remote !== null) await applyRemote(db, id, remote, { complete: false, cancel: false });
      else await db.execute("UPDATE local_task SET sync_state = 'synced' WHERE id = ?", [id]);
      sent += 1;
    } catch (error) {
      if (!(error instanceof TransportError)) {
        await db.execute("UPDATE local_task SET sync_state = 'queued' WHERE id = ?", [id]);
        throw error;
      }
      const kind = classifyFailure(error.kind);
      if (kind === "permanent" || kind === "conflict") {
        await db.execute("UPDATE local_task SET sync_state = 'rejected', last_error = ?, updated_at = ? WHERE id = ?", [error.message, isoNow(env), id]);
        rejected += 1;
        continue;
      }
      await db.execute("UPDATE local_task SET sync_state = 'queued', last_error = ? WHERE id = ?", [error.message, id]);
      return { attempted, sent, rejected, stoppedBy: kind === "auth" ? "auth" : "offline" };
    }
  }
  return { attempted, sent, rejected, stoppedBy: "idle" };
}

/** Brings the server's tasks to the device. Rows with pending commands are never overwritten; tasks absent from the answer (and synced) are removed. */
export async function pullTasks(db: SqlDatabase, ownerAccountId: string, dataset: DatasetIdentity, transport: TaskTransport): Promise<number> {
  const remote = await transport.listTasks();
  await db.transaction(async (tx) => {
    const seen = new Set<string>();
    for (const task of remote) {
      seen.add(task.id);
      const existing = (await tx.query<SqlRow>("SELECT sync_state FROM local_task WHERE id = ? AND owner_account_id = ?", [task.id, ownerAccountId]))[0];
      if (existing !== undefined) {
        if (String(existing.sync_state) !== "synced") continue;
        await tx.execute(
          `UPDATE local_task SET task_type = ?, title = ?, description = ?, due_at = ?, reminder_lead_minutes = ?, customer_code = ?, customer_name = ?, status = ?, completed_at = ?,
             version = ?, updated_at = ? WHERE id = ?`,
          [task.type, task.title, task.description, task.dueAt, task.reminderLeadMinutes, task.customerCode, task.customerName, task.status, task.completedAt, task.version, task.updatedAt, task.id],
        );
        continue;
      }
      await tx.execute(
        `INSERT INTO local_task (id, owner_account_id, dataset_environment, dataset_id, task_type, title, description, due_at, reminder_lead_minutes, customer_code, customer_name,
           status, completed_at, version, created_at, updated_at, sync_state, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', 0)`,
        [task.id, ownerAccountId, dataset.environment, dataset.datasetId, task.type, task.title, task.description, task.dueAt, task.reminderLeadMinutes, task.customerCode, task.customerName, task.status, task.completedAt, task.version, task.createdAt, task.updatedAt],
      );
    }
    const local = await tx.query<SqlRow>("SELECT id FROM local_task WHERE owner_account_id = ? AND dataset_environment = ? AND dataset_id = ? AND sync_state = 'synced'", [ownerAccountId, dataset.environment, dataset.datasetId]);
    for (const row of local) if (!seen.has(String(row.id))) await tx.execute("DELETE FROM local_task WHERE id = ?", [String(row.id)]);
  });
  return remote.length;
}

/** The seller dropped a refused task. */
export async function discardLocalTask(db: SqlExecutor, ownerAccountId: string, id: string): Promise<void> {
  await db.execute("DELETE FROM local_task WHERE id = ? AND owner_account_id = ? AND sync_state IN ('queued', 'rejected')", [id, ownerAccountId]);
}
