/**
 * Storage-engine-agnostic SQL surface of the mobile local database (MOB-2). `apps/mobile` and the future repositories
 * / sync services talk to `SqlDatabase` only; the concrete SQLite library sits behind `RawConnection` in a driver
 * module (`./expo`), so replacing the library never touches callers.
 */

export type SqlValue = string | number | null | Uint8Array;
export type SqlParams = readonly SqlValue[];
export type SqlRow = Record<string, SqlValue>;

export interface ExecuteResult {
  readonly changes: number;
  readonly lastInsertRowId: number;
}

/** What a driver must provide. One connection, statements run one at a time. */
export interface RawConnection {
  run(sql: string, params: SqlParams): Promise<ExecuteResult>;
  all(sql: string, params: SqlParams): Promise<SqlRow[]>;
  close(): Promise<void>;
}

export interface SqlExecutor {
  execute(sql: string, params?: SqlParams): Promise<ExecuteResult>;
  query<T extends SqlRow = SqlRow>(sql: string, params?: SqlParams): Promise<T[]>;
}

export interface SqlDatabase extends SqlExecutor {
  /**
   * Runs `work` inside `BEGIN IMMEDIATE … COMMIT`; any throw rolls back and rethrows. All other statements on this
   * database wait until the transaction ends, so nothing outside `work` can leak into it (the failure mode of
   * connection-level transaction helpers when calls interleave). Nesting is refused: use the `tx` argument.
   */
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export class NestedTransactionError extends Error {
  constructor() {
    super("Nested transactions are not supported; use the executor passed to transaction().");
    this.name = "NestedTransactionError";
  }
}

/** Wraps a raw connection with a FIFO lock so statements and transactions never interleave. */
export function createSqlDatabase(raw: RawConnection): SqlDatabase {
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const result = tail.then(job, job);
    tail = result.catch(() => undefined);
    return result;
  };
  let inTransaction = false;

  const executor: SqlExecutor = {
    execute: (sql, params = []) => raw.run(sql, params),
    query: <T extends SqlRow = SqlRow>(sql: string, params: SqlParams = []) => raw.all(sql, params) as Promise<T[]>,
  };

  return {
    execute: (sql, params = []) => enqueue(() => raw.run(sql, params)),
    query: <T extends SqlRow = SqlRow>(sql: string, params: SqlParams = []) =>
      enqueue(() => raw.all(sql, params) as Promise<T[]>),
    transaction: <T>(work: (tx: SqlExecutor) => Promise<T>) => {
      if (inTransaction) return Promise.reject(new NestedTransactionError());
      return enqueue(async () => {
        inTransaction = true;
        try {
          await raw.run("BEGIN IMMEDIATE", []);
          try {
            const value = await work(executor);
            await raw.run("COMMIT", []);
            return value;
          } catch (error) {
            await raw.run("ROLLBACK", []).catch(() => undefined);
            throw error;
          }
        } finally {
          inTransaction = false;
        }
      });
    },
    close: () => enqueue(() => raw.close()),
  };
}
