// Module: customers — persistent 30-day cache of the public CNPJ lookups (BrasilAPI / publica.cnpj.ws).
// Holds only the public company registry answer, keyed by the 14 CNPJ digits. A cache, not a business record: rows may be
// deleted at any time.
import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const cnpjLookupCache = pgTable(
  'cnpj_lookup_cache',
  {
    cnpj: text('cnpj').primaryKey(),
    /** Normalized company answer (see `ExternalCompany` in apps/server). */
    payload: jsonb('payload').notNull(),
    source: text('source').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    check('cnpj_lookup_cache_cnpj_chk', sql`${t.cnpj} ~ '^[0-9]{14}$'`),
    check('cnpj_lookup_cache_source_chk', sql`${t.source} in ('brasilapi', 'cnpjws')`),
  ],
);
