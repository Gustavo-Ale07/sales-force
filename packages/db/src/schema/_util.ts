import { sql } from 'drizzle-orm';

/** Renders a SQL literal list for CHECK constraints from a const tuple (`'a', 'b'`). */
export const inList = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', '));
