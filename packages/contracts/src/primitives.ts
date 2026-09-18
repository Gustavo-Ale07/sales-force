import { z } from 'zod';

/**
 * Shared building blocks. Every schema that should appear as a reusable OpenAPI component is
 * registered with `named(id, schema)`; the OpenAPI builder resolves them into `components.schemas`.
 * The registry is local (not Zod's global registry) so importing the package has no global side effect.
 */
export const schemaRegistry = z.registry<{ id: string }>();
const usedIds = new Set<string>();

export function named<T extends z.ZodType>(id: string, schema: T): T {
  if (usedIds.has(id)) throw new Error(`Duplicate contract schema id: ${id}`);
  if (schemaRegistry.has(schema))
    throw new Error(`Schema instance already registered; cannot also name it ${id}`);
  usedIds.add(id);
  schemaRegistry.add(schema, { id });
  return schema;
}

/** Decimal values (money, quantities, prices) always travel as plain decimal strings (DATA-3). */
export const DecimalStringSchema = named(
  'DecimalString',
  z
    .string()
    .regex(/^\d+(\.\d+)?$/, 'Expected a plain non-negative decimal string')
    .max(40)
    .meta({
      description: 'Plain decimal string (no sign, exponent or separators). Never a JSON number.',
    }),
);

/** ISO-8601 timestamp. Server-generated values always use UTC (`Z`). */
export const IsoTimestampSchema = named('IsoTimestamp', z.iso.datetime({ offset: true }));

/** Integer business code mirrored from the ERP (seller, customer, product, table...). */
export const codeInt = (): z.ZodNumber => z.number().int().min(0);

export const UuidSchema = z.uuid();

/* ---------- query-string helpers (values arrive as strings) ---------- */

export const queryInt = (min: number, max?: number): z.ZodCoercedNumber => {
  const base = z.coerce.number().int().min(min);
  return (max === undefined ? base : base.max(max)) as z.ZodCoercedNumber;
};

/** `true`/`false` literal strings; never `z.coerce.boolean()` (which treats "false" as true). */
export const queryBoolean = () => z.enum(['true', 'false']).transform((v) => v === 'true');

export const querySearch = () => z.string().trim().min(1).max(100);

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

/** Fields shared by every paginated list query. */
export const paginationQueryShape = {
  page: queryInt(1).default(1),
  pageSize: queryInt(1, MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
};

/** Pagination envelope `{items,page,pageSize,total}`. */
export function paginated<T extends z.ZodType>(id: string, item: T) {
  return named(
    id,
    z.object({
      items: z.array(item),
      page: z.number().int().min(1),
      pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE),
      total: z.number().int().min(0),
    }),
  );
}
