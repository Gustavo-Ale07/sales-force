import {
  cancelLocalTask,
  completeLocalTask,
  countPendingTasks,
  countUnreadLocal,
  createLocalTask,
  listLocalNotifications,
  listLocalTasks,
  markReadLocal,
  pendingReadIds,
  pullTasks,
  pushTasks,
  readExpectedDataset,
  recoverInterruptedTasks,
  storeNotifications,
  TransportError,
  isoNow,
  type LocalNotification,
  type LocalTask,
  type NewTaskInput,
  type OfflineEnv,
  type RemoteTask,
  type SqlDatabase,
  type TaskTransport,
} from "@salesforce/mobile-db";
import { callApi, type ApiClient } from "../data/api";
import { toTransportError } from "./transport";

/** `TaskTransport` over the generated client. The task id is the idempotency key of every attempt (RF-ACT-2). */
export function createTaskTransport(api: ApiClient): TaskTransport {
  const wrap = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      throw error instanceof TransportError ? error : toTransportError(error);
    }
  };
  return {
    createTask: (task) => wrap(() => callApi(() => api.POST("/tasks", { body: task })) as Promise<RemoteTask>),
    completeTask: (id, completedAt) => wrap(() => callApi(() => api.POST("/tasks/{id}/complete", { params: { path: { id } }, body: completedAt === null ? {} : { completedAt } })) as Promise<RemoteTask>),
    cancelTask: (id) => wrap(() => callApi(() => api.POST("/tasks/{id}/cancel", { params: { path: { id } } })) as Promise<RemoteTask>),
    listTasks: async () => (await wrap(() => callApi(() => api.GET("/tasks", { params: { query: { limit: 200 } } })))).items as RemoteTask[],
  };
}

export interface TasksPort {
  list(): Promise<LocalTask[]>;
  create(input: NewTaskInput): Promise<LocalTask>;
  complete(id: string): Promise<LocalTask>;
  cancel(id: string): Promise<LocalTask>;
  /** Sends the queued commands, then reads the server list. Never throws on a dead network. */
  sync(): Promise<void>;
  counters(): Promise<{ pending: number; needsAttention: number }>;
}

export interface NotificationsPort {
  list(): Promise<LocalNotification[]>;
  unreadCount(): Promise<number>;
  /** Reads the server list into the device cache and sends the reads made offline. Never throws on a dead network. */
  refresh(): Promise<void>;
  markRead(ids?: readonly string[]): Promise<void>;
}

interface Deps {
  readonly db: SqlDatabase;
  readonly env: OfflineEnv;
  readonly api: ApiClient;
  readonly ownerAccountId: string;
  readonly onChanged?: () => void;
}

export function createTasksPort(deps: Deps): TasksPort {
  const transport = createTaskTransport(deps.api);
  const changed = () => deps.onChanged?.();
  return {
    list: async () => listLocalTasks(deps.db, deps.ownerAccountId, await readExpectedDataset(deps.db)),
    create: async (input) => {
      const task = await createLocalTask(deps.db, deps.env, deps.ownerAccountId, input);
      changed();
      return task;
    },
    complete: async (id) => {
      const task = await completeLocalTask(deps.db, deps.env, deps.ownerAccountId, id);
      changed();
      return task;
    },
    cancel: async (id) => {
      const task = await cancelLocalTask(deps.db, deps.env, deps.ownerAccountId, id);
      changed();
      return task;
    },
    async sync() {
      const dataset = await readExpectedDataset(deps.db);
      if (dataset === null) return;
      await recoverInterruptedTasks(deps.db);
      try {
        const pushed = await pushTasks(deps.db, deps.env, transport, deps.ownerAccountId, dataset);
        if (pushed.stoppedBy === "idle") await pullTasks(deps.db, deps.ownerAccountId, dataset, transport);
      } catch (error) {
        if (!(error instanceof TransportError)) throw error;
      }
    },
    counters: () => countPendingTasks(deps.db, deps.ownerAccountId),
  };
}

export function createNotificationsPort(deps: Deps): NotificationsPort {
  return {
    list: () => listLocalNotifications(deps.db, deps.ownerAccountId),
    unreadCount: () => countUnreadLocal(deps.db, deps.ownerAccountId),
    async refresh() {
      try {
        const pending = await pendingReadIds(deps.db, deps.ownerAccountId);
        if (pending.length > 0) await callApi(() => deps.api.POST("/notifications/read", { body: { ids: pending.slice(0, 200) } }));
        const response = await callApi(() => deps.api.GET("/notifications", { params: { query: { limit: 100 } } }));
        await storeNotifications(deps.db, deps.ownerAccountId, response.items as LocalNotification[]);
      } catch (error) {
        // A dead network keeps what is on the device; any other failure is a real error.
        const mapped = toTransportError(error);
        if (mapped.kind !== "network" && mapped.kind !== "server" && mapped.kind !== "auth" && mapped.kind !== "rate_limit") throw error;
      }
    },
    async markRead(ids) {
      await markReadLocal(deps.db, deps.ownerAccountId, isoNow(deps.env), ids);
      deps.onChanged?.();
    },
  };
}
