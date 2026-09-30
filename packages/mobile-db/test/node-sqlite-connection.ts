import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { createSqlDatabase, type RawConnection, type SqlDatabase, type SqlRow } from "../src/connection";

/** Real SQLite (Node's built-in) behind the same RawConnection port the device driver implements. Not encrypted. */
export function openNodeDatabase(path = ":memory:"): SqlDatabase {
  const native = new DatabaseSync(path);
  const raw: RawConnection = {
    run: async (sql, params) => {
      const result = native.prepare(sql).run(...(params as SQLInputValue[]));
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    all: async (sql, params) => native.prepare(sql).all(...(params as SQLInputValue[])) as SqlRow[],
    close: async () => native.close(),
  };
  return createSqlDatabase(raw);
}
