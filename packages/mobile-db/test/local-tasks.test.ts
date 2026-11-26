import { beforeEach, describe, expect, it } from "vitest";
import {
  cancelLocalTask,
  completeLocalTask,
  countPendingTasks,
  createLocalTask,
  listLocalNotifications,
  listLocalTasks,
  markReadLocal,
  migrations,
  pendingReadIds,
  pullTasks,
  pushTasks,
  runMigrations,
  storeNotifications,
  TaskError,
  TransportError,
  type NewTaskInput,
  type OfflineEnv,
  type RemoteTask,
  type SqlDatabase,
  type TaskTransport,
} from "../src/index";
import { confirm, REAL } from "./helpers";
import { openNodeDatabase } from "./node-sqlite-connection";

const OWNER = "acct-1";
let n = 0;
const env: OfflineEnv = { now: () => new Date("2026-11-26T12:00:00.000Z"), newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` };
const input: NewTaskInput = { type: "call", title: "Ligar", description: null, dueAt: "2026-11-27T12:00:00.000Z", reminderLeadMinutes: 30, customerCode: null };

type Outcome = "ok" | TransportError;

class Server implements TaskTransport {
  script: Outcome[] = ["ok"];
  tasks = new Map<string, RemoteTask>();
  calls: string[] = [];
  private step(): void {
    const next = this.script.length > 1 ? this.script.shift() : this.script[0];
    if (next instanceof TransportError) throw next;
  }
  async createTask(task: NewTaskInput & { id: string }): Promise<RemoteTask> {
    this.calls.push(`create:${task.id}`);
    this.step();
    const existing = this.tasks.get(task.id);
    if (existing !== undefined) return existing;
    const made: RemoteTask = { ...task, customerName: null, status: "pending", completedAt: null, version: 1, createdAt: "2026-11-26T12:00:00.000Z", updatedAt: "2026-11-26T12:00:00.000Z" };
    this.tasks.set(task.id, made);
    return made;
  }
  async completeTask(id: string, completedAt: string | null): Promise<RemoteTask> {
    this.calls.push(`complete:${id}`);
    this.step();
    const current = this.tasks.get(id) as RemoteTask;
    const done: RemoteTask = current.status === "completed" ? current : { ...current, status: "completed", completedAt, version: current.version + 1 };
    this.tasks.set(id, done);
    return done;
  }
  async cancelTask(id: string): Promise<RemoteTask> {
    this.calls.push(`cancel:${id}`);
    this.step();
    const current = this.tasks.get(id) as RemoteTask;
    const next: RemoteTask = { ...current, status: "cancelled", version: current.version + 1 };
    this.tasks.set(id, next);
    return next;
  }
  async listTasks(): Promise<readonly RemoteTask[]> {
    return [...this.tasks.values()];
  }
}

let db: SqlDatabase;
let server: Server;

beforeEach(async () => {
  n = 0;
  db = await openNodeDatabase();
  await runMigrations(db, migrations);
  await confirm(db, REAL);
  server = new Server();
});

describe("offline tasks", () => {
  it("creates and completes offline, sends create then complete once, and a lost reply replays with the same id", async () => {
    const task = await createLocalTask(db, env, OWNER, input);
    await completeLocalTask(db, env, OWNER, task.id);
    expect((await countPendingTasks(db, OWNER)).pending).toBe(1);
    server.script = [new TransportError("network", "sem rede"), "ok"];
    const first = await pushTasks(db, env, server, OWNER, REAL);
    expect(first.stoppedBy).toBe("offline");
    const second = await pushTasks(db, env, server, OWNER, REAL);
    expect(second.sent).toBe(1);
    expect(server.calls).toEqual([`create:${task.id}`, `create:${task.id}`, `complete:${task.id}`]);
    expect(server.tasks.size).toBe(1);
    const [row] = await listLocalTasks(db, OWNER, REAL);
    expect(row?.status).toBe("completed");
    expect(row?.syncState).toBe("synced");
    expect(await pushTasks(db, env, server, OWNER, REAL)).toMatchObject({ attempted: 0, stoppedBy: "idle" });
  });

  it("marks a refused task as needing attention and never retries it", async () => {
    const task = await createLocalTask(db, env, OWNER, input);
    server.script = [new TransportError("validation", "Cliente fora da carteira", 404)];
    const result = await pushTasks(db, env, server, OWNER, REAL);
    expect(result.rejected).toBe(1);
    expect((await countPendingTasks(db, OWNER)).needsAttention).toBe(1);
    expect((await pushTasks(db, env, server, OWNER, REAL)).attempted).toBe(0);
    expect((await listLocalTasks(db, OWNER, REAL))[0]?.id).toBe(task.id);
  });

  it("refuses a blank title and completing a cancelled task", async () => {
    await expect(createLocalTask(db, env, OWNER, { ...input, title: "  " })).rejects.toBeInstanceOf(TaskError);
    const task = await createLocalTask(db, env, OWNER, input);
    await cancelLocalTask(db, env, OWNER, task.id);
    await expect(completeLocalTask(db, env, OWNER, task.id)).rejects.toBeInstanceOf(TaskError);
  });

  it("a pull never overwrites a task with pending commands and drops synced tasks the server no longer lists", async () => {
    const mine = await createLocalTask(db, env, OWNER, input);
    server.tasks.set("srv-1", { ...input, id: "srv-1", customerName: null, status: "pending", completedAt: null, version: 1, createdAt: "x", updatedAt: "x" });
    await pullTasks(db, OWNER, REAL, server);
    expect((await listLocalTasks(db, OWNER, REAL)).map((t) => t.id).sort()).toEqual([mine.id, "srv-1"].sort());
    server.tasks.clear();
    await pullTasks(db, OWNER, REAL, server);
    expect((await listLocalTasks(db, OWNER, REAL)).map((t) => t.id)).toEqual([mine.id]);
  });
});

describe("notification cache", () => {
  it("keeps an offline read until the server confirms it", async () => {
    const item = { id: "n1", category: "task", title: "Lembrete", body: "Ligar", refType: "task" as const, refId: "t1", readAt: null, createdAt: "2026-11-26T11:00:00.000Z" };
    await storeNotifications(db, OWNER, [item]);
    await markReadLocal(db, OWNER, "2026-11-26T12:00:00.000Z", ["n1"]);
    expect(await pendingReadIds(db, OWNER)).toEqual(["n1"]);
    await storeNotifications(db, OWNER, [item]);
    expect((await listLocalNotifications(db, OWNER))[0]?.readAt).toBe("2026-11-26T12:00:00.000Z");
  });
});
